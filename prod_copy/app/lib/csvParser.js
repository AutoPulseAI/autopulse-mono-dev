import csv from 'csv-parser';
import fs from 'fs';
import { promisify } from 'util';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const readdir = promisify(fs.readdir);

export const parseCSV = (filePath) => {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', (error) => reject(error));
  });
};

export const processCSVFiles = async (directory) => {
  try {
    const files = await readdir(directory);
    return files.filter(file => file.endsWith('.csv'));
  } catch (error) {
    console.error('Error reading directory:', error);
    return [];
  }
};

export const moveProcessedFile = async (sourcePath, destinationPath) => {
  try {
    await writeFile(destinationPath, await readFile(sourcePath));
    await unlink(sourcePath);
    return true;
  } catch (error) {
    console.error('Error moving file:', error);
    return false;
  }
};