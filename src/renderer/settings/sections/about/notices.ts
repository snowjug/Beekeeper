export interface Notice {
  name: string;
  license: string;
  use: string;
}

/** The main open-source building blocks. All of them are permissively licensed. */
export const THIRD_PARTY_NOTICES: readonly Notice[] = [
  { name: 'Electron', license: 'MIT', use: 'Desktop runtime' },
  { name: 'React', license: 'MIT', use: 'User interface' },
  { name: 'Framer Motion', license: 'MIT', use: 'Animation' },
  { name: 'Tailwind CSS', license: 'MIT', use: 'Styling' },
  { name: 'Vosk (vosk-browser)', license: 'Apache-2.0', use: 'Offline speech recognition' },
  { name: 'Tesseract.js', license: 'Apache-2.0', use: 'Offline text recognition (OCR)' },
  { name: 'zod', license: 'MIT', use: 'Validation' },
  { name: 'electron-updater', license: 'MIT', use: 'Updates' },
  { name: 'electron-log', license: 'MIT', use: 'Logging' },
  { name: 'openai (Node SDK)', license: 'Apache-2.0', use: 'Optional Azure OpenAI client' },
];

export const MIT_EXCERPT = [
  'MIT License',
  'Copyright (c) 2026 Atharv Shukla',
  'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:',
  'The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.',
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.',
] as const;
