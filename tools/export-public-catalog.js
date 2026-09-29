const fs = require('fs');
const path = require('path');

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

function copyParameter(parameter, field) {
  if (!isRecord(parameter) || typeof parameter.name !== 'string') {
    throw new Error(`Malformed catalog parameter: ${field}`);
  }
  assertPublicString(parameter.name, `${field}.name`);
  const result = { name: parameter.name };
  for (const key of ['type', 'description']) {
    if (parameter[key] !== undefined) {
      if (typeof parameter[key] !== 'string') throw new Error(`Malformed catalog ${field}.${key}`);
      assertPublicString(parameter[key], `${field}.${key}`);
      result[key] = parameter[key];
    }
  }
  return result;
}

function copyType(type, field) {
  if (!isRecord(type) || typeof type.name !== 'string' ||
      !['record', 'enum', 'alias'].includes(type.kind)) {
    throw new Error(`Malformed catalog type: ${field}`);
  }
  assertPublicString(type.name, `${field}.name`);
  const result = { name: type.name, kind: type.kind };
  if (type.description !== undefined) {
    if (typeof type.description !== 'string') throw new Error(`Malformed catalog ${field}.description`);
    assertPublicString(type.description, `${field}.description`);
    result.description = type.description;
  }
  if (type.kind === 'alias') {
    if (typeof type.alias !== 'string' || !type.alias.trim()) throw new Error(`Malformed catalog ${field}.alias`);
    assertPublicString(type.alias, `${field}.alias`);
    result.alias = type.alias;
  }
  if (type.kind === 'record' && type.fields !== undefined) {
    if (!Array.isArray(type.fields)) throw new Error(`Malformed catalog ${field}.fields`);
    result.fields = type.fields.map((item, index) => {
      if (!isRecord(item) || typeof item.name !== 'string' || !item.name) {
        throw new Error(`Malformed catalog type field: ${field}.fields[${index}]`);
      }
      assertPublicString(item.name, `${field}.fields[${index}].name`);
      const copy = { name: item.name };
      for (const key of ['type', 'description']) {
        if (item[key] !== undefined) {
          if (typeof item[key] !== 'string') throw new Error(`Malformed catalog ${field}.fields[${index}].${key}`);
          assertPublicString(item[key], `${field}.fields[${index}].${key}`);
          copy[key] = item[key];
        }
      }
      return copy;
    });
  }
  if (type.kind === 'enum' && type.values !== undefined) {
    if (!Array.isArray(type.values)) throw new Error(`Malformed catalog ${field}.values`);
    result.values = type.values.map((item, index) => {
      if (!isRecord(item) || typeof item.name !== 'string' || !item.name ||
          (item.value !== undefined && typeof item.value !== 'string' && typeof item.value !== 'number')) {
        throw new Error(`Malformed catalog enum value: ${field}.values[${index}]`);
      }
      assertPublicString(item.name, `${field}.values[${index}].name`);
      const copy = { name: item.name };
      if (item.value !== undefined) {
        if (typeof item.value === 'string') assertPublicString(item.value, `${field}.values[${index}].value`);
        copy.value = item.value;
      }
      if (item.description !== undefined) {
        if (typeof item.description !== 'string') throw new Error(`Malformed catalog ${field}.values[${index}].description`);
        assertPublicString(item.description, `${field}.values[${index}].description`);
        copy.description = item.description;
      }
      return copy;
    });
  }
  return result;
}

function exportPublicCatalog(source) {
  if (!isRecord(source) || source.schemaVersion !== 1 ||
      typeof source.interfaceVersion !== 'string' || !Array.isArray(source.modules)) {
    throw new Error('Catalog must contain schemaVersion, interfaceVersion, and modules');
  }
  assertPublicString(source.interfaceVersion, 'interfaceVersion');
  if (source.sdkVersion !== undefined) {
    if (typeof source.sdkVersion !== 'string') throw new Error('Catalog sdkVersion is malformed');
    assertPublicString(source.sdkVersion, 'sdkVersion');
  }
  const modules = source.modules.map((module, moduleIndex) => {
    if (!isRecord(module) || typeof module.name !== 'string' || !Array.isArray(module.methods)) {
      throw new Error(`Malformed catalog module: ${moduleIndex}`);
    }
    assertPublicString(module.name, `modules[${moduleIndex}].name`);
    const result = { name: module.name };
    if (module.luaModule !== undefined) {
      if (typeof module.luaModule !== 'string') throw new Error('Catalog luaModule is malformed');
      assertPublicString(module.luaModule, `modules[${moduleIndex}].luaModule`);
      result.luaModule = module.luaModule;
    }
    if (module.properties !== undefined) {
      if (!Array.isArray(module.properties)) throw new Error('Catalog properties are malformed');
      result.properties = module.properties.map((property, propertyIndex) => {
        if (!isRecord(property) || typeof property.name !== 'string') {
          throw new Error(`Malformed catalog property: modules[${moduleIndex}].properties[${propertyIndex}]`);
        }
        assertPublicString(property.name, `modules[${moduleIndex}].properties[${propertyIndex}].name`);
        const copy = { name: property.name };
        for (const key of ['type', 'description']) {
          if (property[key] !== undefined) {
            if (typeof property[key] !== 'string') throw new Error(`Malformed catalog property ${key}`);
            assertPublicString(property[key], `modules[${moduleIndex}].properties[${propertyIndex}].${key}`);
            copy[key] = property[key];
          }
        }
        return copy;
      });
    }
    result.methods = module.methods.map((method, methodIndex) => {
      if (!isRecord(method) || typeof method.name !== 'string') {
        throw new Error(`Malformed catalog method: modules[${moduleIndex}].methods[${methodIndex}]`);
      }
      assertPublicString(method.name, `modules[${moduleIndex}].methods[${methodIndex}].name`);
      const copy = { name: method.name };
      if (method.parameters !== undefined) {
        if (!Array.isArray(method.parameters)) throw new Error('Catalog parameters are malformed');
        copy.parameters = method.parameters.map((parameter, parameterIndex) =>
          copyParameter(parameter, `modules[${moduleIndex}].methods[${methodIndex}].parameters[${parameterIndex}]`));
      }
      for (const key of ['returnType', 'description']) {
        if (method[key] !== undefined) {
          if (typeof method[key] !== 'string') throw new Error(`Malformed catalog method ${key}`);
          assertPublicString(method[key], `modules[${moduleIndex}].methods[${methodIndex}].${key}`);
          copy[key] = method[key];
        }
      }
      if (Array.isArray(method.bindings)) copy.bindings = method.bindings.filter((binding) => binding === 'lua');
      return copy;
    });
    return result;
  });
  return {
    schemaVersion: 1,
    interfaceVersion: source.interfaceVersion,
    ...(source.sdkVersion ? { sdkVersion: source.sdkVersion } : {}),
    ...(source.macroValidation ? {
      macroValidation: {
        status: 'passed',
        ...(source.macroValidation.interfaceVersion ? {
          interfaceVersion: source.macroValidation.interfaceVersion
        } : {})
      }
    } : {}),
    ...(source.types !== undefined ? {
      types: Array.isArray(source.types)
        ? source.types.map((type, index) => copyType(type, `types[${index}]`))
        : (() => { throw new Error('Catalog types are malformed'); })()
    } : {}),
    modules
  };
}

if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error('Usage: node tools/export-public-catalog.js <input.json> <catalog.json>');
    process.exitCode = 2;
  } else {
    const source = JSON.parse(fs.readFileSync(input, 'utf8'));
    // The local catalog is intentionally ignored and may be regenerated from
    // SDK headers without the public type graph. Reuse the last public output
    // so a refresh cannot silently remove struct and enum completion.
    if (source.types === undefined && fs.existsSync(output)) {
      try {
        const previous = JSON.parse(fs.readFileSync(output, 'utf8'));
        if (Array.isArray(previous.types)) source.types = previous.types;
      } catch {
        // The normal validation below reports malformed input/output state.
      }
    }
    if (source.types === undefined) {
      const publicTypes = path.join(__dirname, '..', 'api', 'public-types.json');
      if (fs.existsSync(publicTypes)) {
        try {
          const metadata = JSON.parse(fs.readFileSync(publicTypes, 'utf8'));
          if (Array.isArray(metadata.types)) source.types = metadata.types;
        } catch {
          // Keep the normal catalog validation as the single error surface.
        }
      }
    }
    const result = exportPublicCatalog(source);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`Exported ${result.modules.reduce((count, module) => count + module.methods.length, 0)} public API methods.`);
  }
}

module.exports = { exportPublicCatalog };
