const { yamlParse, yamlDump } = require('yaml-cfn');

const fs = require('fs');

let cfn_template = JSON.parse(fs.readFileSync('glycodomain.template'));


fs.writeFileSync('glycodomain.template.yaml',yamlDump(cfn_template));