const fs = require('fs');
const path = require('path');
const { buildCatalog } = require('./generate-catalog.js');

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertPublicString(value, field) {
  if (typeof value !== 'string') return;
  if (/^\/?(?:[A-Za-z]:[\\/]|root\/|home\/)|https?:\/\//i.test(value) ||
      /(?:common_interface|aubo_sdk|aubo_script)/i.test(value)) {
    throw new Error(`Refusing private or path-like catalog field: ${field}`);
  }
}

function readJson(filename) {
  try {
    return JSON.parse(fs.readFileSync(filename, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Input JSON is not valid: ${filename}`);
    }
    throw error;
  }
}

function validationFrom(source) {
  const candidates = [];
  if (Object.prototype.hasOwnProperty.call(source, 'macroValidation')) candidates.push(source.macroValidation);
  if (Object.prototype.hasOwnProperty.call(source, 'validation')) candidates.push(source.validation);
  if (!candidates.length) {
    throw new Error("Input must contain macroValidation.status='passed'");
  }

  let interfaceVersion;
  for (const candidate of candidates) {
    if (!isRecord(candidate) || candidate.status !== 'passed') {
      throw new Error("Input macroValidation.status must be 'passed'");
    }
    if (candidate.interfaceVersion !== undefined && typeof candidate.interfaceVersion !== 'string') {
      throw new Error('Input macroValidation.interfaceVersion must be a string');
    }
    if (candidate.interfaceVersion !== undefined) {
      if (interfaceVersion !== undefined && candidate.interfaceVersion !== interfaceVersion) {
        throw new Error('Input macro validation interfaceVersion values do not match');
      }
      interfaceVersion = candidate.interfaceVersion;
    }
  }
  return { status: 'passed', ...(interfaceVersion === undefined ? {} : { interfaceVersion }) };
}

function validateCatalogShape(catalog) {
  if (!isRecord(catalog) || catalog.schemaVersion !== 1 ||
      typeof catalog.interfaceVersion !== 'string' || !Array.isArray(catalog.modules)) {
    throw new Error('Input catalog must contain schemaVersion, interfaceVersion, and modules');
  }
  for (const module of catalog.modules) {
    if (!isRecord(module) || typeof module.name !== 'string' || !Array.isArray(module.methods)) {
      throw new Error('Input catalog module is malformed');
    }
    const names = new Set();
    for (const method of module.methods) {
      if (!isRecord(method) || typeof method.name !== 'string') {
        throw new Error('Input catalog method is malformed');
      }
      if (names.has(method.name)) throw new Error(`Input catalog contains duplicate method: ${method.name}`);
      names.add(method.name);
      if (method.parameters !== undefined && !Array.isArray(method.parameters)) {
        throw new Error('Input catalog method parameters are malformed');
      }
      if (Array.isArray(method.parameters)) {
        for (const parameter of method.parameters) {
          if (!isRecord(parameter) || typeof parameter.name !== 'string') {
            throw new Error('Input catalog parameter is malformed');
          }
        }
      }
      if (method.bindings !== undefined &&
          (!Array.isArray(method.bindings) || method.bindings.some((binding) => typeof binding !== 'string'))) {
        throw new Error('Input catalog method bindings are malformed');
      }
    }
    if (module.luaModule !== undefined && typeof module.luaModule !== 'string') {
      throw new Error('Input catalog module luaModule is malformed');
    }
    if (module.properties !== undefined && (!Array.isArray(module.properties) ||
        module.properties.some((property) => !isRecord(property) || typeof property.name !== 'string'))) {
      throw new Error('Input catalog module properties are malformed');
    }
  }
  if (catalog.sdkVersion !== undefined && typeof catalog.sdkVersion !== 'string') {
    throw new Error('Input catalog sdkVersion is malformed');
  }
  if (catalog.sdkVersion === 'local-sdk') {
    throw new Error('Input catalog sdkVersion must be a real SDK version');
  }
  if (catalog.types !== undefined) {
    if (!Array.isArray(catalog.types)) throw new Error('Input catalog types are malformed');
    const typeNames = new Set();
    for (const type of catalog.types) {
      if (!isRecord(type) || typeof type.name !== 'string' ||
          !['record', 'enum', 'alias'].includes(type.kind)) {
        throw new Error('Input catalog type is malformed');
      }
      if (typeNames.has(type.name)) throw new Error(`Input catalog contains duplicate type: ${type.name}`);
      typeNames.add(type.name);
      assertPublicString(type.name, 'types.name');
      if (type.description !== undefined && typeof type.description !== 'string') {
        throw new Error('Input catalog type description is malformed');
      }
      if (type.description !== undefined) assertPublicString(type.description, 'types.description');
      if (type.kind === 'alias') {
        if (typeof type.alias !== 'string' || !type.alias.trim()) throw new Error('Input catalog alias is malformed');
        assertPublicString(type.alias, 'types.alias');
      }
      if (type.kind === 'record' && type.fields !== undefined) {
        if (!Array.isArray(type.fields)) throw new Error('Input catalog type fields are malformed');
        const fieldNames = new Set();
        for (const field of type.fields) {
          if (!isRecord(field) || typeof field.name !== 'string' || !field.name) throw new Error('Input catalog type field is malformed');
          if (fieldNames.has(field.name)) throw new Error(`Input catalog contains duplicate field: ${type.name}.${field.name}`);
          fieldNames.add(field.name);
          assertPublicString(field.name, 'types.fields.name');
          if (field.type !== undefined && typeof field.type !== 'string') throw new Error('Input catalog field type is malformed');
          if (field.description !== undefined && typeof field.description !== 'string') throw new Error('Input catalog field description is malformed');
          if (field.type !== undefined) assertPublicString(field.type, 'types.fields.type');
          if (field.description !== undefined) assertPublicString(field.description, 'types.fields.description');
        }
      }
      if (type.kind === 'enum' && type.values !== undefined) {
        if (!Array.isArray(type.values)) throw new Error('Input catalog enum values are malformed');
        const valueNames = new Set();
        for (const value of type.values) {
          if (!isRecord(value) || typeof value.name !== 'string' || !value.name ||
              (value.value !== undefined && typeof value.value !== 'string' && typeof value.value !== 'number')) {
            throw new Error('Input catalog enum value is malformed');
          }
          if (valueNames.has(value.name)) throw new Error(`Input catalog contains duplicate enum value: ${type.name}.${value.name}`);
          valueNames.add(value.name);
          assertPublicString(value.name, 'types.values.name');
          if (typeof value.value === 'string') assertPublicString(value.value, 'types.values.value');
          if (value.description !== undefined && typeof value.description !== 'string') throw new Error('Input catalog enum value description is malformed');
          if (value.description !== undefined) assertPublicString(value.description, 'types.values.description');
        }
      }
    }
  }
}

function copyParameter(parameter) {
  const result = { name: parameter.name };
  for (const key of ['type', 'description']) {
    if (typeof parameter[key] === 'string') result[key] = parameter[key];
  }
  return result;
}

function copyType(type) {
  const result = { name: type.name, kind: type.kind };
  for (const key of ['description', 'alias']) {
    if (typeof type[key] === 'string') result[key] = type[key];
  }
  if (type.kind === 'record' && Array.isArray(type.fields)) {
    result.fields = type.fields.map((field) => ({
      name: field.name,
      ...(typeof field.type === 'string' ? { type: field.type } : {}),
      ...(typeof field.description === 'string' ? { description: field.description } : {})
    }));
  }
  if (type.kind === 'enum' && Array.isArray(type.values)) {
    result.values = type.values.map((value) => ({
      name: value.name,
      ...(value.value === undefined ? {} : { value: value.value }),
      ...(typeof value.description === 'string' ? { description: value.description } : {})
    }));
  }
  return result;
}

function sanitizeCatalog(catalog, macroValidation) {
  validateCatalogShape(catalog);
  if (macroValidation.interfaceVersion !== undefined &&
      macroValidation.interfaceVersion !== catalog.interfaceVersion) {
    throw new Error('Input macro validation interfaceVersion does not match catalog interfaceVersion');
  }
  const result = {
    schemaVersion: 1,
    interfaceVersion: catalog.interfaceVersion,
    ...(typeof catalog.sdkVersion === 'string' ? { sdkVersion: catalog.sdkVersion } : {}),
    ...(Array.isArray(catalog.types) ? { types: catalog.types.map(copyType) } : {}),
    modules: catalog.modules.map((module) => ({
      name: module.name,
      ...(typeof module.luaModule === 'string' ? { luaModule: module.luaModule } : {}),
      ...(Array.isArray(module.properties) ? {
        properties: module.properties.map((property) => ({
          name: property.name,
          ...(typeof property.type === 'string' ? { type: property.type } : {}),
          ...(typeof property.description === 'string' ? { description: property.description } : {})
        }))
      } : {}),
      methods: module.methods.map((method) => {
        const copy = { name: method.name };
        if (Array.isArray(method.parameters)) copy.parameters = method.parameters.map(copyParameter);
        for (const key of ['returnType', 'description']) {
          if (typeof method[key] === 'string') copy[key] = method[key];
        }
        if (Array.isArray(method.bindings)) copy.bindings = method.bindings.filter((binding) => typeof binding === 'string');
        return copy;
      })
    })),
    macroValidation
  };
  return result;
}

function buildUpdatedCatalog(source, options = {}) {
  if (!isRecord(source)) throw new Error('Input JSON must contain an object');
  const normalizedOptions = typeof options === 'string' ? { expectedInterfaceVersion: options } : (options || {});
  const artifact = isRecord(source.catalog)
    ? { ...source.catalog, ...(source.macroValidation === undefined ? {} : { macroValidation: source.macroValidation }), ...(source.validation === undefined ? {} : { validation: source.validation }) }
    : source;
  const macroValidation = validationFrom(artifact);
  const binding = typeof normalizedOptions.binding === 'string' ? normalizedOptions.binding : 'javascript';
  let catalog;
  if (Array.isArray(artifact.functions)) {
    const functionSource = artifact.interfaceVersion === undefined && macroValidation.interfaceVersion !== undefined
      ? { ...artifact, interfaceVersion: macroValidation.interfaceVersion }
      : artifact;
    catalog = buildCatalog(functionSource, binding);
  } else {
    catalog = artifact;
  }
  const result = sanitizeCatalog(catalog, macroValidation);
  const expected = normalizedOptions.expectedInterfaceVersion;
  if (expected !== undefined && typeof expected !== 'string') {
    throw new Error('expectedInterfaceVersion must be a string');
  }
  if (expected !== undefined && result.interfaceVersion !== expected) {
    throw new Error(`interfaceVersion ${result.interfaceVersion} does not match expectedInterfaceVersion ${expected}`);
  }
  return result;
}

function writeAtomic(filename, contents) {
  const resolved = path.resolve(filename);
  const directory = path.dirname(resolved);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(resolved)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
  let committed = false;
  try {
    fs.writeFileSync(temporary, contents, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporary, resolved);
    committed = true;
  } finally {
    if (!committed) {
      try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
}

function updateCatalog(input, output, options = {}) {
  if (!output) throw new Error('Output catalog path is required');
  const normalizedOptions = typeof options === 'string'
    ? { expectedInterfaceVersion: options }
    : (options || {});
  const source = typeof input === 'string' ? readJson(input) : input;
  const result = buildUpdatedCatalog(source, normalizedOptions);
  writeAtomic(output, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

function parseArgs(args) {
  const [input, output, ...rest] = args;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--expected-interface-version') {
      if (index + 1 >= rest.length) throw new Error('--expected-interface-version requires a value');
      options.expectedInterfaceVersion = rest[++index];
    }
    else if (arg.startsWith('--expected-interface-version=')) options.expectedInterfaceVersion = arg.slice('--expected-interface-version='.length);
    else if (arg === '--binding') {
      if (index + 1 >= rest.length) throw new Error('--binding requires a value');
      options.binding = rest[++index];
    }
    else if (arg.startsWith('--binding=')) options.binding = arg.slice('--binding='.length);
    else if (!options.binding) options.binding = arg;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return { input, output, options };
}

if (require.main === module) {
  try {
    const { input, output, options } = parseArgs(process.argv.slice(2));
    if (!input || !output) {
      console.error('Usage: node tools/update-catalog.js <input.json> <catalog.json> [binding] [--expected-interface-version <version>]');
      process.exitCode = 2;
    } else {
      let source = readJson(input);
      if (source.types === undefined) {
        const publicTypes = path.join(__dirname, '..', 'api', 'public-types.json');
        if (fs.existsSync(publicTypes)) {
          try {
            const metadata = readJson(publicTypes);
            if (Array.isArray(metadata.types)) source = { ...source, types: metadata.types };
          } catch {
            // Keep catalog validation as the single error surface.
          }
        }
      }
      const catalog = updateCatalog(source, output, options);
      const methods = catalog.modules.reduce((count, module) => count + module.methods.length, 0);
      console.log(`Updated ${methods} API methods for ${catalog.interfaceVersion}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  buildUpdatedCatalog,
  normalizeCatalog: buildUpdatedCatalog,
  updateCatalog,
  updateCatalogFile: updateCatalog
};
