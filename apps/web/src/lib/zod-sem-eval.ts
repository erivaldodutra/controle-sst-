import { z } from 'zod';

// Importado antes de tudo: a CSP do sistema proíbe eval, e sem isto o zod 4 testa Function()
// para compilar as validações e o navegador registra a recusa.
z.config({ jitless: true });
