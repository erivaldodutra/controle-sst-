import { app, BrowserWindow, dialog, Menu, safeStorage, shell } from 'electron';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { GestorBackup } from './gestorBackup';
import { Cofre, Servidor } from './servidor';

const pastaDados = join(app.getPath('userData'), 'dados');
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
let janela: BrowserWindow | null = null;
let saindo = false;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (janela) {
    if (janela.isMinimized()) janela.restore();
    janela.focus();
  }
});

async function iniciar() {
  Menu.setApplicationMenu(null);
  const carregando = new BrowserWindow({ width: 420, height: 220, frame: false, resizable: false, show: true });
  carregando.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    '<body style="font-family:Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#1d2733">' +
    '<div style="text-align:center"><b>Controle SST</b><p style="color:#64748b">Iniciando o banco de dados local…</p></div></body>'));
  try {
    servidor = new Servidor({
      pastaDados, pastaWeb, pastaMigrations, cofre, log,
      backup: (srv) => (gestor = new GestorBackup(srv, {
        escolherDestino: async (nome) => (await dialog.showSaveDialog(janela!, {
          title: 'Salvar cópia do backup', defaultPath: nome, filters: [{ name: 'Backup do Controle SST', extensions: ['sstbak'] }],
        })).filePath ?? null,
        escolherArquivo: async () => (await dialog.showOpenDialog(janela!, {
          title: 'Escolha o backup para restaurar', properties: ['openFile'], filters: [{ name: 'Backup do Controle SST', extensions: ['sstbak'] }],
        })).filePaths[0] ?? null,
        reiniciar: () => {
          app.relaunch();
          saindo = true;
          app.exit(0);
        },
      })),
    });
    await servidor.iniciar();
    log(`Servidor local em ${servidor.url}`);
  } catch (e: any) {
    log(`Falha ao iniciar: ${e?.stack ?? e}`);
    carregando.destroy();
    dialog.showErrorBox('Controle SST', `Não foi possível iniciar o sistema.\n\n${e?.message ?? e}\n\nDetalhes em: ${pastaLogs}`);
    app.exit(1);
    return;
  }

  janela = new BrowserWindow({
    width: 1366, height: 860, minWidth: 1024, minHeight: 640, show: false, title: 'Controle SST',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const origem = servidor.url;
  // Nada sai do aplicativo: links externos abrem no navegador do sistema, navegação fora do servidor local é bloqueada.
  janela.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(origem)) return { action: 'allow' };
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  janela.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(origem)) e.preventDefault();
  });
  janela.webContents.session.on('will-download', (_e, item) => {
    item.setSaveDialogOptions({ title: 'Salvar arquivo' });
  });
  await janela.loadURL(origem);
  carregando.destroy();
  janela.maximize();
  janela.show();
}

app.whenReady().then(iniciar);

app.on('window-all-closed', () => app.quit());

// Ao fechar: backup automático (se houver senha de backup) e desligamento limpo do banco.
app.on('before-quit', (e) => {
  if (saindo || !servidor) return;
  e.preventDefault();
  saindo = true;
  (async () => {
    try {
      if (gestor && servidor?.segredos.senhaBackup) {
        await gestor.criarAgora(false);
        log('Backup automático criado ao fechar');
      }
    } catch (x: any) {
      log(`Falha no backup automático: ${x?.message}`);
    }
    await servidor?.parar();
    app.exit(0);
  })();
});
