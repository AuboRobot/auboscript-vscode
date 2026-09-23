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
    modules
  };
}

if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error('Usage: node tools/export-public-catalog.js <input.json> <catalog.json>');
    process.exitCode = 2;
  } else {
    const result = exportPublicCatalog(JSON.parse(fs.readFileSync(input, 'utf8')));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`Exported ${result.modules.reduce((count, module) => count + module.methods.length, 0)} public API methods.`);
  }
}

module.exports = { exportPublicCatalog };
