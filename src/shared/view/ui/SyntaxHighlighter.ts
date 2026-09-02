import { PrismLight } from 'react-syntax-highlighter';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import cpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp';
import csharp from 'react-syntax-highlighter/dist/esm/languages/prism/csharp';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import diff from 'react-syntax-highlighter/dist/esm/languages/prism/diff';
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go';
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup';
import powershell from 'react-syntax-highlighter/dist/esm/languages/prism/powershell';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';
import oneDark from 'react-syntax-highlighter/dist/esm/styles/prism/one-dark';
import oneLight from 'react-syntax-highlighter/dist/esm/styles/prism/one-light';

const languages = {
  bash,
  cpp,
  csharp,
  css,
  diff,
  go,
  java,
  javascript,
  json,
  jsx,
  markdown,
  markup,
  powershell,
  python,
  rust,
  sql,
  tsx,
  typescript,
  yaml,
};

Object.entries(languages).forEach(([name, grammar]) => {
  PrismLight.registerLanguage(name, grammar);
});

PrismLight.alias('bash', ['shell', 'sh']);
PrismLight.alias('javascript', 'js');
PrismLight.alias('markup', ['html', 'xml']);
PrismLight.alias('powershell', 'ps1');
PrismLight.alias('python', 'py');
PrismLight.alias('typescript', 'ts');
PrismLight.alias('yaml', 'yml');

export { oneDark, oneLight };
export default PrismLight;
