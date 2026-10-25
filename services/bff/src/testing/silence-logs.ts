import { Logger } from '@nestjs/common';

// Las pruebas unitarias no necesitan los logs de Nest (los errores esperados ensucian la salida).
Logger.overrideLogger(false);
