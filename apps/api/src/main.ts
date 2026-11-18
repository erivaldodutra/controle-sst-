import { criarApp } from './app';
import { configDoAmbiente } from './comum/config';

/** Execução avulsa da API (desenvolvimento). O aplicativo de desktop usa criarApp diretamente. */
async function main() {
  const { app } = await criarApp({ config: configDoAmbiente(), pastaWeb: process.env.SST_PASTA_WEB });
  const porta = Number(process.env.PORT ?? 3333);
  await app.listen(porta, '127.0.0.1');
  console.log(`API em http://127.0.0.1:${porta}/api`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
