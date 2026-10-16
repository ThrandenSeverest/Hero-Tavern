// Adapted from bmen25124/SillyTavern-WTracker (MIT), commit 8a5e42e6cbea0b63ca0fb92b5ce52ec4a399012c.
// JSON parser from src/parser.ts; XML transport omitted for the local KoboldCpp adapter.
function jsonToXml(json     , indent = 0)         {
  let xml = '';
  const indentation = '  '.repeat(indent);
  for (const key in json) {
    if (json.hasOwnProperty(key)) {
      const value = json[key];
      if (Array.isArray(value)) {
        value.forEach((item) => {
          if (typeof item === 'object' && item !== null) {
            xml += `${indentation}<${key}>\n`;
            xml += jsonToXml(item, indent + 1);
            xml += `${indentation}</${key}>\n`;
          } else {
            xml += `${indentation}<${key}>${item}</${key}>\n`;
          }
        });
      } else if (typeof value === 'object' && value !== null) {
        xml += `${indentation}<${key}>\n`;
        xml += jsonToXml(value, indent + 1);
        xml += `${indentation}</${key}>\n`;
      } else {
        xml += `${indentation}<${key}>${value}</${key}>\n`;
      }
    }
  }
  return xml;
}

function schemaToExample(schema     , format                )         {
  const example = generateExample(schema);
  if (format === 'xml') {
    return jsonToXml(example).trim();
  }
  return JSON.stringify(example, null, 2);
}

function generateExample(schema     )      {
  if (schema.example) {
    return schema.example;
  }

  switch (schema.type) {
    case 'object':
      const obj                         = {};
      if (schema.properties) {
        for (const key in schema.properties) {
          obj[key] = generateExample(schema.properties[key]);
        }
      }
      return obj;
    case 'array':
      if (schema.items) {
        return [generateExample(schema.items)];
      }
      return [];
    case 'string':
      return schema.description || 'string';
    case 'number':
      return 0;
    case 'boolean':
      return false;
    default:
      return null;
  }
}

function parseResponse(content) {
  const codeBlockRegex = /```(?:\w+\n|\n)([\s\S]*?)```/;
  const codeBlockMatch = content.match(codeBlockRegex);
  const cleanedContent = codeBlockMatch ? codeBlockMatch[1].trim() : content.trim();
  return JSON.parse(cleanedContent);
}
module.exports = {parseResponse, schemaToExample};
