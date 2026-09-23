const fs = require('fs');
const path = require('path');

function buildCatalog(source, binding = 'javascript') {
  if (!source || !Array.isArray(source.functions)) {
    throw new Error('SDK function.json must contain a functions array');
  }
  const functions = [...new Set(source.functions)]
    .filter((name) => typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
    .sort();
  if (!functions.length) throw new Error('SDK function.json contains no valid functions');
  const validation = source.macroValidation || source.validation;
  if (validation !== undefined &&
      (!validation || validation.status !== 'passed' ||
       (validation.interfaceVersion !== undefined &&
        validation.interfaceVersion !== source.interfaceVersion))) {
    throw new Error('macroValidation must have status passed and matching interfaceVersion');
  }
  const interfaceVersion = typeof source.interfaceVersion === 'string' ? source.interfaceVersion : 'local-sdk';
  const sdkVersion = typeof source.sdkVersion === 'string' ? source.sdkVersion
    : (interfaceVersion === 'local-sdk' ? undefined : interfaceVersion);
  if (sdkVersion === 'local-sdk') throw new Error('sdkVersion must be a real SDK version');
  const module = {
    name: 'AuboSdk',
    ...(typeof source.luaModule === 'string' ? { luaModule: source.luaModule } : {}),
    ...(Array.isArray(source.properties) ? { properties: source.properties } : {}),
    methods: functions.map((name) => ({ name, bindings: [binding] }))
  };
  return {
    schemaVersion: 1,
    interfaceVersion,
    ...(sdkVersion ? { sdkVersion } : {}),
    ...(validation ? {
      macroValidation: {
        status: 'passed',
        ...(typeof validation.interfaceVersion === 'string'
          ? { interfaceVersion: validation.interfaceVersion } : {})
      }
    } : {}),
    modules: [module]
  };
}

if (require.main === module) {
  const [input, output, binding = 'javascript'] = process.argv.slice(2);
  if (!input || !output) {
    console.error('Usage: node tools/generate-catalog.js <function.json> <catalog.json> [binding]');
    process.exit(2);
  }
  const source = JSON.parse(fs.readFileSync(input, 'utf8'));
  const catalog = buildCatalog(source, binding);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`Generated ${catalog.modules[0].methods.length} API methods for ${binding}`);
}

module.exports = { buildCatalog };
