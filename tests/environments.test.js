'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Environments, cleanTerms } = require('../src/core/environments');
const { countryOf } = require('../src/core/country');
const { candidateFilter, buildTasks } = require('../src/core/sources');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jh-env-'));

test('cria ambientes separados, cada um com a própria pasta, e persiste a lista', () => {
  const root = tmp();
  const envs = new Environments(root);
  const a = envs.create({ name: 'Design de interiores', terms: 'designer de interiores, interior designer, Interior Designer' });
  const b = envs.create({ name: 'Administrativo', terms: ['assistente administrativo'] });
  assert.deepEqual(a.terms, ['designer de interiores', 'interior designer']); // sem repetição
  assert.notEqual(envs.dirOf(a.id), envs.dirOf(b.id));
  assert.ok(fs.existsSync(envs.dirOf(a.id)));
  const again = new Environments(root);
  assert.deepEqual(again.list().map((e) => e.name), ['Design de interiores', 'Administrativo']);
});

test('valida nome e termos; não aceita nome repetido nem id fora da lista', () => {
  const envs = new Environments(tmp());
  assert.throws(() => envs.create({ name: '  ', terms: 'x' }), /nome/i);
  assert.throws(() => envs.create({ name: 'A', terms: '' }), /tipo de vaga/i);
  envs.create({ name: 'A', terms: 'x' });
  assert.throws(() => envs.create({ name: 'a', terms: 'y' }), /já existe/i);
  assert.throws(() => envs.dirOf('../fora'), /não encontrado/i);
  assert.equal(cleanTerms(new Array(50).fill(0).map((_, i) => `t${i}`)).length, 20);
});

test('ids de ambientes com nomes parecidos não colidem', () => {
  const envs = new Environments(tmp());
  const a = envs.create({ name: 'Arquitetura', terms: 'x' });
  const b = envs.create({ name: 'Arquitetura!', terms: 'x' });
  assert.notEqual(a.id, b.id);
});

test('país da vaga pelo texto do local; sem país claro devolve null', () => {
  assert.deepEqual(countryOf('Belo Horizonte, MG'), { code: 'BR', name: 'Brasil' });
  assert.equal(countryOf('Austin, Texas').code, 'US');
  assert.equal(countryOf('Remote - USA').code, 'US');
  assert.equal(countryOf('Lisboa, Portugal').code, 'PT');
  assert.equal(countryOf('Worldwide'), null);
  assert.equal(countryOf(''), null);
});

test('com termos do ambiente, o filtro usa os termos e não o filtro de ArchViz', () => {
  const keep = candidateFilter({ terms: ['designer de interiores'] });
  assert.equal(keep({ title: 'Designer de Interiores Sênior', description: '' }), true);
  assert.equal(keep({ title: 'Archviz Artist', description: 'corona render' }), false);
  const archviz = candidateFilter({ terms: [] });
  assert.equal(archviz({ title: 'Architectural Visualization Artist', description: '' }), true);
});

test('as buscas da Gupy usam os termos do ambiente', () => {
  const tasks = buildTasks({ terms: ['assistente administrativo'], gupy: true }, async () => ({}));
  assert.deepEqual(tasks.filter((t) => t.key.startsWith('gupy:')).map((t) => t.key), ['gupy:assistente administrativo']);
});
