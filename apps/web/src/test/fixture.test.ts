// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import fixture from './fixtures/result.factura.json';

// Esquema canónico del monorepo (contracts/), relativo a apps/web.
const schemaPath = resolve(process.cwd(), '../../contracts/validation-result.schema.json');

describe('fixture result.factura.json', () => {
  it('valida contra contracts/validation-result.schema.json', () => {
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as object;
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const ok = validate(fixture);
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });
});
