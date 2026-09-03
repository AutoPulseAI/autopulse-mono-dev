// lib/csvCronService.js
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';
import { parseCSV } from './csvParser.js';
import CSVImportData from '@models/CSVImportData';
import CSVImportedData from '@models/CSVImportedData';
import dbConnect from './mongodb.js';

const execAsync = promisify(exec);

class CSVCronService {
  constructor() {
    this.isRunning = false;
    this.intervalId = null;
    this.checkInterval = 30000; // Check every 30 seconds
    this.uploadDir = path.join(process.cwd(), 'public/csv/dealersocket/uploads');
    this.processedDir = path.join(process.cwd(), 'public/csv/dealersocket/processed');
    this.failedDir = path.join(process.cwd(), 'public/csv/dealersocket/failed');
    this.tempDir = path.join(process.cwd(), 'public/csv/dealersocket/temp');
    this.directoriesEnsured = false;
  }

  /**
   * Ensure all required directories exist (with error handling)
   */
  ensureDirectories() {
    if (this.directoriesEnsured) return;
    
    try {
      [this.uploadDir, this.processedDir, this.failedDir, this.tempDir].forEach(dir => {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
          console.log(`Created directory: ${dir}`);
        }
      });
      this.directoriesEnsured = true;
    } catch (error) {
      console.warn('Could not create CSV directories (this is normal during build):', error.message);
      // Don't throw error during build - directories will be created when service actually runs
    }
  }

  /**
   * Start the CSV processing cron service
   */
  start() {
    // Don't start during build process
    if (process.env.NODE_ENV === 'production' && process.env.NEXT_PHASE === 'phase-production-build') {
      console.log('Skipping CSV cron service start during build phase');
      return;
    }
    
    if (this.isRunning) {
      console.log('CSV cron service is already running');
      return;
    }

    console.log('Starting CSV processing cron service...');
    
    // Ensure directories exist when service starts
    this.ensureDirectories();
    
    this.isRunning = true;
    
    // Run immediately on start
    this.checkAndProcessFiles();
    
    // Then run on interval
    this.intervalId = setInterval(() => {
      this.checkAndProcessFiles();
    }, this.checkInterval);

    console.log(`CSV cron service started - checking every ${this.checkInterval / 1000} seconds`);
  }

  /**
   * Stop the CSV processing cron service
   */
  stop() {
    if (!this.isRunning) {
      console.log('CSV cron service is not running');
      return;
    }

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.isRunning = false;
    console.log('CSV cron service stopped successfully');
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      checkInterval: this.checkInterval,
      uploadDir: this.uploadDir,
      processedDir: this.processedDir,
      failedDir: this.failedDir
    };
  }

  /**
   * Manual check and process files
   */
  async manualCheck() {
    console.log('Manual CSV file check triggered');
    return await this.checkAndProcessFiles();
  }

  /**
   * Check for files and process them
   */
  async checkAndProcessFiles() {
    try {
      // Ensure directories exist before processing
      this.ensureDirectories();
      
      //console.log(`[${new Date().toISOString()}] Checking for files in ${this.uploadDir}...`);
      
      const files = await this.getFilesToProcess();
      
      if (files.length === 0) {
        //console.log('No files found to process');
        return { filesProcessed: 0, rowsImported: 0 };
      }

      console.log(`Found ${files.length} files to process:`, files.map(f => f.name));

      let totalFilesProcessed = 0;
      let totalRowsImported = 0;

      for (const file of files) {
        try {
          console.log(`Processing file: ${file.name}`);
          const result = await this.processFile(file);
          totalFilesProcessed += result.filesProcessed;
          totalRowsImported += result.rowsImported;
        } catch (error) {
          console.error(`Error processing file ${file.name}:`, error);
          await this.moveToFailed(file.path, error.message);
        }
      }

      console.log(`Processed ${totalFilesProcessed} files, imported ${totalRowsImported} rows`);
      return { filesProcessed: totalFilesProcessed, rowsImported: totalRowsImported };

    } catch (error) {
      console.error('Error in CSV cron service:', error);
      return { filesProcessed: 0, rowsImported: 0, error: error.message };
    }
  }

  /**
   * Get list of files to process
   */
  async getFilesToProcess() {
    try {
      const files = fs.readdirSync(this.uploadDir);
      return files
        .filter(file => {
          const ext = path.extname(file).toLowerCase();
          return ext === '.zip' || ext === '.csv';
        })
        .map(file => ({
          name: file,
          path: path.join(this.uploadDir, file),
          ext: path.extname(file).toLowerCase()
        }));
    } catch (error) {
      console.error('Error reading upload directory:', error);
      return [];
    }
  }

  /**
   * Process a single file (zip or csv)
   */
  async processFile(file) {
    const { name, path: filePath, ext } = file;
    
    // Get file size
    const fileStats = fs.statSync(filePath);
    const fileSize = fileStats.size;
    
    // Create CSVImportData record for tracking
    const csvDataRecord = new CSVImportData({
      original_filename: name,
      file_type: ext.substring(1), // Remove the dot
      file_size: fileSize,
      file_path: filePath,
      processing_status: 'processing'
    });
    
    await csvDataRecord.save();
    await csvDataRecord.addLog('info', `Started processing file: ${name}`);
    
    try {
      let result;
      
      if (ext === '.zip') {
        result = await this.processZipFile(filePath, name, csvDataRecord);
      } else if (ext === '.csv') {
        result = await this.processCsvFile(filePath, name, csvDataRecord);
      } else {
        throw new Error(`Unsupported file type: ${ext}`);
      }
      
      // Update CSVImportData record with results
      await csvDataRecord.updateStatus('completed', {
        total_records: result.totalRecords || 0,
        records_imported: result.rowsImported || 0,
        records_skipped: result.recordsSkipped || 0,
        records_failed: result.recordsFailed || 0,
        processed_file_path: result.processedFilePath
      });
      
      await csvDataRecord.addLog('info', `Successfully processed file: ${name}`, {
        filesProcessed: result.filesProcessed,
        rowsImported: result.rowsImported
      });
      
      return result;
      
    } catch (error) {
      // Update CSVImportData record with error
      await csvDataRecord.updateStatus('failed', {
        error_message: error.message,
        error_details: error.stack,
        failed_file_path: await this.moveToFailed(filePath, error.message)
      });
      
      await csvDataRecord.addLog('error', `Failed to process file: ${name}`, {
        error: error.message
      });
      
      throw error;
    }
  }

  /**
   * Process a zip file
   */
  async processZipFile(zipPath, zipName, csvDataRecord) {
    console.log(`Extracting zip file: ${zipName}`);
    
    const extractDir = path.join(this.tempDir, `extract_${Date.now()}`);
    
    try {
      // Create extraction directory
      fs.mkdirSync(extractDir, { recursive: true });
      
      // Extract zip file
      await execAsync(`unzip -o "${zipPath}" -d "${extractDir}"`);
      
      // Find CSV files in extracted directory
      const csvFiles = await this.findCsvFiles(extractDir);
      
      if (csvFiles.length === 0) {
        throw new Error('No CSV files found in zip archive');
      }

      console.log(`Found ${csvFiles.length} CSV files in zip:`, csvFiles.map(f => f.name));

      let totalRowsImported = 0;
      const processedFiles = [];
      const extractedFileRecords = [];

      // Process each CSV file - create separate CSVImportData record for each
      for (const csvFile of csvFiles) {
        try {
          // Create a separate CSVImportData record for each extracted CSV file
          const csvFileStats = fs.statSync(csvFile.path);
          const extractedCsvDataRecord = new CSVImportData({
            original_filename: csvFile.name,
            file_type: 'csv',
            file_size: csvFileStats.size,
            file_path: csvFile.path,
            processing_status: 'processing',
            import_source: 'zip_extraction',
            parent_zip_file: zipName
          });

          await extractedCsvDataRecord.save();
          await extractedCsvDataRecord.addLog('info', `Started processing extracted CSV file: ${csvFile.name} from zip: ${zipName}`);

          const result = await this.processCsvFile(csvFile.path, csvFile.name, extractedCsvDataRecord);
          totalRowsImported += result.rowsImported;
          processedFiles.push(csvFile.name);
          
          // Update the extracted CSV file record with results
          await extractedCsvDataRecord.updateStatus('completed', {
            total_records: result.totalRecords || 0,
            records_imported: result.rowsImported || 0,
            records_skipped: result.recordsSkipped || 0,
            records_failed: result.recordsFailed || 0,
            processed_file_path: result.processedFilePath
          });

          await extractedCsvDataRecord.addLog('info', `Successfully processed extracted CSV file: ${csvFile.name}`, {
            rowsImported: result.rowsImported,
            totalRecords: result.totalRecords
          });

          // Add extracted file info to parent ZIP record
          extractedFileRecords.push({
            filename: csvFile.name,
            records_count: result.totalRecords || 0,
            imported_count: result.rowsImported || 0,
            skipped_count: result.recordsSkipped || 0,
            failed_count: result.recordsFailed || 0,
            csv_data_id: extractedCsvDataRecord._id
          });

        } catch (error) {
          console.error(`Error processing CSV ${csvFile.name} from zip:`, error);
          await csvDataRecord.addLog('error', `Failed to process CSV ${csvFile.name} from zip`, {
            error: error.message
          });
          // Continue processing other files
        }
      }

      // Update the parent ZIP record with extracted files info
      csvDataRecord.extracted_files = extractedFileRecords;
      await csvDataRecord.save();

      // Clean up extraction directory
      await this.cleanupDirectory(extractDir);

      // Move zip to processed directory
      const processedFilePath = await this.moveToProcessed(zipPath, zipName);

      console.log(`Successfully processed zip file ${zipName}: ${processedFiles.length} CSV files, ${totalRowsImported} rows imported`);
      
      return {
        filesProcessed: processedFiles.length,
        rowsImported: totalRowsImported,
        processedFiles,
        processedFilePath
      };

    } catch (error) {
      // Clean up extraction directory if it exists
      if (fs.existsSync(extractDir)) {
        await this.cleanupDirectory(extractDir);
      }
      throw error;
    }
  }

  /**
   * Process a CSV file
   */
  async processCsvFile(csvPath, csvName, csvDataRecord) {
    console.log(`Processing CSV file: ${csvName}`);
    
    try {
      await dbConnect();
      
      // Parse CSV file
      const records = await parseCSV(csvPath);
      
      if (!records || records.length === 0) {
        console.log(`No data found in CSV file: ${csvName}`);
        return { filesProcessed: 1, rowsImported: 0, totalRecords: 0 };
      }

      // Analyze CSV structure
      const csvStructure = this.analyzeCSVStructure(records);
      csvDataRecord.csv_structure = csvStructure;
      await csvDataRecord.save();

      // Process records and save to database
      const result = await this.saveRecordsToDatabase(records, csvName, csvDataRecord);
      
      console.log(`Successfully processed CSV file ${csvName}: ${result.rowsImported} rows imported`);
      
      return {
        filesProcessed: 1,
        rowsImported: result.rowsImported,
        totalRecords: records.length,
        recordsSkipped: result.recordsSkipped,
        recordsFailed: result.recordsFailed
      };

    } catch (error) {
      console.error(`Error processing CSV file ${csvName}:`, error);
      throw error;
    }
  }

  /**
   * Find CSV files in a directory recursively
   */
  async findCsvFiles(dir) {
    const csvFiles = [];
    
    const scanDir = (currentDir) => {
      const items = fs.readdirSync(currentDir);
      
      for (const item of items) {
        const itemPath = path.join(currentDir, item);
        const stat = fs.statSync(itemPath);
        
        if (stat.isDirectory()) {
          scanDir(itemPath);
        } else if (path.extname(item).toLowerCase() === '.csv') {
          csvFiles.push({
            name: item,
            path: itemPath
          });
        }
      }
    };
    
    scanDir(dir);
    return csvFiles;
  }

  /**
   * Save records to database
   */
  async saveRecordsToDatabase(records, sourceFile, csvDataRecord) {
    let rowsImported = 0;
    let recordsSkipped = 0;
    let recordsFailed = 0;
    
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      
      try {
        // Validate required fields
        if (!record.name || (!record.email && !record.phone)) {
          //console.log(`Skipping record ${i} - missing required fields:`, record);
          recordsSkipped++;
          
          // Add skipped record to separate CSVImportedData model
          await new CSVImportedData({
            csv_import_id: csvDataRecord._id,
            record_index: i,
            source_data: record,
            import_status: 'skipped',
            error_message: 'Missing required fields'
          }).save();
          continue;
        }

        // Process and clean the record data
        const processedRecord = {
          name: record.name,
          email: record.email || '',
          phone: this.formatPhone(record.phone) || '',
          followup_preference: record.followup_preference || 'email',
          vehicle_make: record.make || record.vehicle_make || '',
          vehicle_model: record.model || record.vehicle_model || '',
          vehicle_year: record.year || record.vehicle_year || '',
          vin: record.vin || '',
          comments: record.comments || record.comment || '',
          dealer_id: record.dealer_id || null,
          dealer_name: record.dealer_name || null,
          dealer_email: record.dealer_email || null,
          source: 'csv_import_auto',
          status: 'New',
          import_source: sourceFile,
          processed_at: new Date()
        };

        // Add successful record to separate CSVImportedData model
        await new CSVImportedData({
          csv_import_id: csvDataRecord._id,
          record_index: i,
          source_data: processedRecord,
          import_status: 'imported'
        }).save();
        rowsImported++;

      } catch (error) {
        console.error(`Error processing record ${i}:`, error, record);
        recordsFailed++;
        
        // Add failed record to separate CSVImportedData model
        await new CSVImportedData({
          csv_import_id: csvDataRecord._id,
          record_index: i,
          source_data: record,
          import_status: 'failed',
          error_message: error.message
        }).save();
        
        // Log the error in CSVImportData record
        await csvDataRecord.addLog('error', `Failed to process record ${i}`, {
          record: record,
          error: error.message
        });
      }
    }

    // Update counts in CSVImportData from the separate CSVImportedData records
    await csvDataRecord.updateCountsFromImportedData();

    return { rowsImported, recordsSkipped, recordsFailed };
  }

  /**
   * Format phone number for consistency
   */
  formatPhone(phone) {
    if (!phone) return '';
    
    // Remove all non-digit characters
    const cleaned = phone.replace(/\D/g, '');
    
    // Add +1 if it's a 10-digit US number
    if (cleaned.length === 10) {
      return `+1${cleaned}`;
    }
    
    // Add + if it's an 11-digit number starting with 1
    if (cleaned.length === 11 && cleaned.startsWith('1')) {
      return `+${cleaned}`;
    }
    
    // Return as-is if it already has country code
    return phone;
  }

  /**
   * Analyze CSV structure for metadata
   */
  analyzeCSVStructure(records) {
    if (!records || records.length === 0) {
      return {
        headers: [],
        total_columns: 0,
        sample_data: [],
        detected_format: 'empty'
      };
    }

    const headers = Object.keys(records[0]);
    const sampleData = records.slice(0, 3); // First 3 records as sample
    
    // Detect format based on common field names
    let detectedFormat = 'generic';
    const headerLower = headers.map(h => h.toLowerCase());
    
    if (headerLower.some(h => h.includes('lead') || h.includes('customer'))) {
      detectedFormat = 'leads';
    } else if (headerLower.some(h => h.includes('vehicle') || h.includes('car'))) {
      detectedFormat = 'vehicles';
    } else if (headerLower.some(h => h.includes('sale') || h.includes('transaction'))) {
      detectedFormat = 'sales';
    }

    return {
      headers,
      total_columns: headers.length,
      sample_data: sampleData,
      detected_format: detectedFormat
    };
  }

  /**
   * Move file to processed directory
   */
  async moveToProcessed(originalPath, fileName) {
    const timestamp = Date.now();
    const newFileName = `${timestamp}_${fileName}`;
    const newPath = path.join(this.processedDir, newFileName);
    
    fs.renameSync(originalPath, newPath);
    console.log(`Moved processed file: ${fileName} -> ${newFileName}`);
    
    return newPath;
  }

  /**
   * Move file to failed directory
   */
  async moveToFailed(originalPath, errorMessage) {
    const timestamp = Date.now();
    const fileName = path.basename(originalPath);
    const newFileName = `${timestamp}_${fileName}`;
    const newPath = path.join(this.failedDir, newFileName);
    
    fs.renameSync(originalPath, newPath);
    
    // Save error details
    const errorFile = path.join(this.failedDir, `${timestamp}_${fileName}.error.txt`);
    fs.writeFileSync(errorFile, `Error: ${errorMessage}\nTime: ${new Date().toISOString()}`);
    
    console.log(`Moved failed file: ${fileName} -> ${newFileName}`);
    
    return newPath;
  }

  /**
   * Clean up directory recursively
   */
  async cleanupDirectory(dir) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

// Create singleton instance
const csvCronService = new CSVCronService();

export default csvCronService;
