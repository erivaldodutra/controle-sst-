import { app, BrowserWindow, dialog, Menu, nativeImage, safeStorage, shell, Tray } from 'electron';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GestorBackup } from './gestorBackup';
import { ICONE_BANDEJA } from './iconeBandeja';
import { escolherPastaDados, trazerDadosAnteriores } from './local';
import { Cofre, Servidor } from './servidor';

/**
 * O Controle SST roda em segundo plano no notebook (ícone na bandeja, perto do relógio)
 * e é usado pelo navegador, no endereço fixo abaixo. Só este computador acessa:
 * o servidor escuta apenas em 127.0.0.1 e não abre porta para a rede.
 */
const PORTA = 8088;
const ENDERECO = `http://localhost:${PORTA}`;

// Instalado em E:, os dados ficam em "E:\Controle SST - Dados" (ver local.ts).
const pastaDadosAntiga = join(app.getPath('userData'), 'dados');
const pastaDados = app.isPackaged
  ? escolherPastaDados({ programa: process.execPath, padrao: pastaDadosAntiga, unidadeSistema: process.env.SystemDrive, windows: process.platform === 'win32' })
  : pastaDadosAntiga;
/** Lembra onde os dados estavam, para achá-los se o programa for reinstalado em outra unidade. */
const arqLocalDados = join(app.getPath('userData'), 'pasta-dados.txt');
const pastaLogs = join(app.getPath('userData'), 'logs');
mkdirSync(pastaLogs, { recursive: true });
const log = (m: string) => {
  try {
    appendFileSync(join(pastaLogs, 'controle-sst.log'), `${new Date().toISOString()} ${m}\n`);
  } catch {
    /* sem log */
  }
};

const recursos = app.isPackaged ? process.resourcesPath : join(__dirname, '..', '..');
const pastaWeb = app.isPackaged ? join(recursos, 'web') : join(recursos, 'web', 'dist');
const pastaMigrations = app.isPackaged ? join(recursos, 'migrations') : join(recursos, 'api', 'migrations');

/** Segredos protegidos pelo Windows (DPAPI): só este usuário, neste computador, consegue ler. */
const cofreSeguro: Cofre = {
  cifrar: (t) => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Proteção de dados do sistema operacional indisponível');
    return safeStorage.encryptString(t);
  },
  decifrar: (b) => safeStorage.decryptString(b),
};
/** Só para desenvolvimento em Linux sem chaveiro do sistema; nunca no aplicativo instalado. */
const cofreDev: Cofre = { cifrar: (t) => Buffer.from(t, 'utf8'), decifrar: (b) => b.toString('utf8') };
const cofre = !app.isPackaged && process.env.SST_DEV_COFRE_SIMPLES === '1' ? cofreDev : cofreSeguro;

let servidor: Servidor | null = null;
let gestor: GestorBackup | null = null;
let bandeja: Tray | null = null;
let saindo = false;
let pronto = false;

const abrirNavegador = () => {
  if (pronto) shell.openExternal(ENDERECO);
};

if (!app.requestSingleInstanceLock()) app.quit();
// Abrir o atalho de novo só abre o navegador; o sistema já está rodando.
app.on('second-instance', abrirNavegador);

function montarMenu() {
  if (!bandeja) return;
  const inicia = app.getLoginItemSettings().openAtLogin;
  bandeja.setContextMenu(Menu.buildFromTemplate([
    { label: pronto ? `Abrir no navegador (${ENDERECO})` : 'Iniciando…', enabled: pronto, click: abrirNavegador },
    { type: 'separator' },
    { label: 'Fazer backup agora', enabled: pronto, click: () => void fazerBackupPelaBandeja() },
    { label: 'Abrir pasta dos backups', enabled: pronto, click: () => gestor && shell.openPath(gestor.config.pasta ?? gestor.pastaPadrao) },
    { label: 'Abrir pasta dos dados', click: () => shell.openPath(pastaDados) },
    { type: 'separator' },
    {
      label: 'Iniciar junto com o Windows', type: 'checkbox', checked: inicia,
      click: (i) => {
        app.setLoginItemSettings({ openAtLogin: i.checked });
        montarMenu();
      },
    },
    { type: 'separator' },
    { label: 'Sair do Controle SST', click: () => app.quit() },
  ]));
}

/**
 * As janelas do Windows (escolher pasta/arquivo) são abertas sobre uma janela invisível
 * "sempre visível", para não ficarem escondidas atrás do navegador.
 */
async function naFrente<T>(abrir: (dono: BrowserWindow) => Promise<T>): Promise<T> {
  const dono = new BrowserWindow({ show: false, alwaysOnTop: true, skipTaskbar: true, width: 1, height: 1 });
  try {
    return await abrir(dono);
  } finally {
    dono.destroy();
  }
}

async function fazerBackupPelaBandeja() {
  if (!gestor) return;
  try {
    if (!servidor?.segredos.senhaBackup) {
      dialog.showMessageBox({ type: 'info', title: 'Controle SST', message: 'Defina a senha dos backups no sistema (menu Backup) antes do primeiro backup.' });
      return;
    }
    const r = await gestor.criarAgora();
    bandeja?.displayBalloon({ title: 'Backup criado', content: r.arquivo, iconType: 'info' });
  } catch (e: any) {
    dialog.showErrorBox('Controle SST', `Não foi possível fazer o backup.\n\n${e?.message ?? e}`);
  }
}

async function iniciar() {
  Menu.setApplicationMenu(null);
  bandeja = new Tray(nativeImage.createFromDataURL(ICONE_BANDEJA));
  bandeja.setToolTip('Controle SST');
  bandeja.on('click', abrirNavegador);
  bandeja.on('double-click', abrirNavegador);
  montarMenu();

  // Na primeira execução, passa a iniciar junto com o Windows (pode ser desligado no menu da bandeja).
  const marca = join(app.getPath('userData'), 'primeira-execucao-feita');
  if (app.isPackaged && !existsSync(marca)) {
    app.setLoginItemSettings({ openAtLogin: true });
    try {
      writeFileSync(marca, new Date().toISOString());
    } catch {
      /* ignora */
    }
    montarMenu();
  }

  try {
    // Traz os dados de onde estavam antes (ex.: C:, versões anteriores) para a pasta atual.
    let anterior: string | null = null;
    try {
      anterior = readFileSync(arqLocalDados, 'utf8').trim() || null;
    } catch {
      /* primeira vez */
    }
    const veioDe = trazerDadosAnteriores(pastaDados, [anterior, pastaDadosAntiga], log);
    mkdirSync(pastaDados, { recursive: true });
    writeFileSync(arqLocalDados, pastaDados);
    if (veioDe && process.platform === 'win32')
      bandeja.displayBalloon({ title: 'Dados transferidos', content: `Os dados agora ficam em ${pastaDados}`, iconType: 'info' });

    servidor = new Servidor({
      pastaDados, pastaWeb, pastaMigrations, cofre, log, portaApi: PORTA,
      backup: (srv) => (gestor = new GestorBackup(srv, {
        escolherDestino: (nome) => naFrente(async (w) => (await dialog.showSaveDialog(w, {
          title: 'Salvar cópia do backup', defaultPath: nome, filters: [{ name: 'Backup do Controle SST', extensions: ['sstbak'] }],
        })).filePath || null),
        escolherArquivo: () => naFrente(async (w) => (await dialog.showOpenDialog(w, {
          title: 'Escolha o backup para restaurar', properties: ['openFile'], filters: [{ name: 'Backup do Controle SST', extensions: ['sstbak'] }],
        })).filePaths[0] ?? null),
        escolherPasta: () => naFrente(async (w) => (await dialog.showOpenDialog(w, {
          title: 'Escolha a pasta dos backups (ex.: pendrive ou HD externo)', properties: ['openDirectory', 'createDirectory'],
        })).filePaths[0] ?? null),
        reiniciar: () => {
          app.relaunch();
          saindo = true;
          app.exit(0);
        },
      }, log)),
    });
    await servidor.iniciar();
    log(`Servidor local em ${servidor.url}`);
  } catch (e: any) {
    log(`Falha ao iniciar: ${e?.stack ?? e}`);
    dialog.showErrorBox('Controle SST', `Não foi possível iniciar o sistema.\n\n${e?.message ?? e}\n\nDetalhes em: ${pastaLogs}`);
    app.exit(1);
    return;
  }

  pronto = true;
  gestor?.iniciarAgendamento();
  montarMenu();
  bandeja.setToolTip(`Controle SST: ${ENDERECO}`);
  // Ao iniciar junto com o Windows fica só na bandeja; aberto pelo usuário, já abre o navegador.
  if (!app.getLoginItemSettings().wasOpenedAtLogin) abrirNavegador();
  if (process.platform === 'win32')
    bandeja.displayBalloon({ title: 'Controle SST está rodando', content: `Acesse pelo navegador: ${ENDERECO}`, iconType: 'info' });
}

app.whenReady().then(iniciar);

// Sem janelas próprias: o aplicativo continua na bandeja até o usuário escolher "Sair".
app.on('window-all-closed', () => {});

// Ao sair: backup automático (se houver senha de backup) e desligamento limpo do banco.
app.on('before-quit', (e) => {
  if (saindo || !servidor) return;
  e.preventDefault();
  saindo = true;
  (async () => {
    try {
      gestor?.pararAgendamento();
      if (gestor && servidor?.segredos.senhaBackup && gestor.config.aoSair) {
        await gestor.criarAgora(false);
        log('Backup automático criado ao sair');
      }
    } catch (x: any) {
      log(`Falha no backup automático: ${x?.message}`);
    }
    await servidor?.parar();
    app.exit(0);
  })();
});
