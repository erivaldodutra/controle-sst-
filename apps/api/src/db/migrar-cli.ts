import { migrar } from './migrar';

const url = process.env.DATABASE_URL_OWNER;
if (!url) {
  console.error('Defina DATABASE_URL_OWNER');
  process.exit(1);
}
migrar(url, undefined, console.log)
  .then(() => console.log('Migrations aplicadas'))
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
