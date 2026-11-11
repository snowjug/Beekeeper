export interface Notice {
  name: string;
  license: string;
  use: string;
}

/**
 * The main building blocks, with the license each one comes under. Everything is open source except
 * the Supertonic voice model (OpenRAIL-M: free to use, with use restrictions) and the ElevenLabs
 * online service, which is optional and needs the user's own account.
 */
export const THIRD_PARTY_NOTICES: readonly Notice[] = [
  { name: 'Electron', license: 'MIT', use: 'Desktop runtime' },
  { name: 'React', license: 'MIT', use: 'User interface' },
  { name: 'Framer Motion', license: 'MIT', use: 'Animation' },
  { name: 'Tailwind CSS', license: 'MIT', use: 'Styling' },
  { name: 'Vosk (vosk-browser)', license: 'Apache-2.0', use: 'Offline speech recognition' },
  { name: 'OpenAI Whisper', license: 'MIT', use: 'Speech recognition models (English and Hindi)' },
  {
    name: 'sherpa-onnx (k2-fsa)',
    license: 'Apache-2.0',
    use: 'Runs the Whisper and natural voice models on this PC',
  },
  {
    name: 'Supertonic 3 (Supertone Inc.)',
    license: 'OpenRAIL-M',
    use: 'Natural voice model (English and Hindi)',
  },
  {
    name: 'Supertonic sample code (Supertone Inc.)',
    license: 'MIT',
    use: 'Natural voice text processing',
  },
  { name: 'Tesseract.js', license: 'Apache-2.0', use: 'Offline text recognition (OCR)' },
  { name: 'zod', license: 'MIT', use: 'Validation' },
  { name: 'electron-updater', license: 'MIT', use: 'Updates' },
  { name: 'electron-log', license: 'MIT', use: 'Logging' },
  { name: 'openai (Node SDK)', license: 'Apache-2.0', use: 'Optional Azure OpenAI client' },
  { name: 'ElevenLabs', license: 'Online service', use: 'Optional cloud voice (your own account)' },
];

export const MIT_EXCERPT = [
  'MIT License',
  'Copyright (c) 2026 Atharv Shukla',
  'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:',
  'The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.',
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.',
] as const;
