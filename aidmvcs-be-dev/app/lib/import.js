import dbConnect from '../lib/mongodb.js'; 
import fs from 'fs';
import path from 'path';
import Vehicle from '@models/Vehicle';
import User from '@models/User';
import { nanoid } from 'nanoid';
import { parseCSV, processCSVFiles, moveProcessedFile } from './csvParser.js';

async function ensureDb() {
  await dbConnect();
}

export class VehicleImportService {
  // Helper function to clean website URL
  cleanWebsiteUrl(url) {
    if (!url) return '';
    
    // Remove https://www. or http://www. or www. prefixes
    return url
      .replace(/^https?:\/\/www\./, '')
      .replace(/^www\./, '')
      .replace(/\/$/, ''); // Remove trailing slash
  }

  async importFromCSV(filePath) {
    await ensureDb();
    const rawRecords = await parseCSV(filePath);
    
    // Get all VINs and dealerIds from the CSV to check for existing records
    const vinsAndDealers = rawRecords.map(raw => {
      const record = this.normalizeRecord(raw);
      return { vin: record.vin, dealerId: record.dealerId };
    }).filter(item => item.vin && item.dealerId);
    
    // Get unique dealer IDs to fetch dealer information
    const uniqueDealerIds = [...new Set(vinsAndDealers.map(item => item.dealerId))];
    
    // Fetch dealer information
    const dealers = await User.find({
      _id: { $in: uniqueDealerIds }
    }).select('_id dealer_account_information.store_website website');
    
    // Create a map for dealer lookup
    const dealerMap = new Map();
    dealers.forEach(dealer => {
      const websiteUrl = dealer.dealer_account_information?.store_website || dealer.website || '';
      dealerMap.set(dealer._id.toString(), this.cleanWebsiteUrl(websiteUrl));
    });
    
    // Fetch existing records in one query
    const existingRecords = await Vehicle.find({
      $or: vinsAndDealers.map(item => ({
        vin: item.vin,
        dealerId: item.dealerId
      }))
    }).select('vin dealerId shortCode shortUrl');
    
    // Create a map for quick lookup
    const existingMap = new Map();
    existingRecords.forEach(record => {
      const key = `${record.vin}_${record.dealerId}`;
      existingMap.set(key, record);
    });
    
    const bulkOps = rawRecords.map(raw => {
      const record = this.normalizeRecord(raw, dealerMap);
      const key = `${record.vin}_${record.dealerId}`;
      const existingRecord = existingMap.get(key);
      
      if (existingRecord && existingRecord.shortCode) {
        // Preserve existing shortCode and shortUrl for updates
        record.shortCode = existingRecord.shortCode;
        record.shortUrl = existingRecord.shortUrl;
      }
      
      return {
        updateOne: {
          filter: { vin: record.vin, dealerId: record.dealerId },
          update: { $set: record },
          upsert: true,
        },
      };
    });

    if (bulkOps.length) {
      const result = await Vehicle.bulkWrite(bulkOps);
      //console.log(`Imported ${result.upsertedCount + result.modifiedCount} rows from ${path.basename(filePath)}`);
      return result.upsertedCount + result.modifiedCount;
    }
    return 0;
  }

  normalizeRecord(raw, dealerMap = null) {
    const out = {};
    
    // List of all possible numeric fields in your data
    const NUMERIC_FIELDS = [
      'price', 'internetprice', 'customerPrice', 'internetreduced',
      'instoreprice', 'msrp', 'mileage', 'rebate', 'wholesale',
      'invoice', 'cost', 'retail', 'latitude', 'longitude',
      'enginesize', 'highwaympg', 'cityMpg', 'dom', 'age','year','seatingcapacity',
      'internetSpecial', 'internetReduced', 'inStorePrice', 'totalCost',
      'customerPrice', 'rebate', 'wholesale', 'invoice', 'cost', 'retail',
      'mpgCity', 'mpgHighway', 'engineDisplacement', 'cylinders'
    ];
    
    // Fields that should be stored as integers
    const INTEGER_FIELDS = [
      'mileage', 'year', 'doorscount', 'cylinders', 'highwaympg',
      'cityMpg', 'dom', 'seatingCapacity','doorscount','citympg',
      'mpgCity', 'mpgHighway', 'engineDisplacement', 'age'
    ];

    // vAuto to standard field mapping
    const VAUTO_FIELD_MAPPING = {
      'accountId': 'DealerID', // Map accountId to DealerID for dealer matching
      'vin': 'VIN',
      'stockNumber': 'StockNumber',
      'year': 'Year',
      'make': 'Make',
      'model': 'Model',
      'series': 'Series',
      'trim': 'Trim',
      'body': 'Body',
      'internetPrice': 'InternetSpecial',
      'mileage': 'Mileage',
      'exteriorColor': 'ExteriorColor',
      'interiorColor': 'InteriorColor',
      'seats': 'SeatingCapacity',
      'engine': 'EngineDescription',
      'drive': 'DriveTrain',
      'transmission': 'Transmission',
      'fuel': 'FuelType',
      'newUsed': 'Condition',
      'age': 'Age',
      'description': 'Comments',
      'options': 'Options',
      'imageUrls': 'PhotoUrls',
      'vehicleUrl': 'Inventory URL',
      'retail': 'InStorePrice',
      'videoUrl': 'VideoURL',
      'invoice': 'Invoice',
      'modelCode': 'ModelCode',
      'cost': 'TotalCost',
      'location': 'Location',
      'vehicleType': 'VehicleType',
      'cpo': 'Certified',
      'mpgCity': 'CityMPG',
      'mpgHighway': 'HighwayMPG',
      'vdp link': 'VdpLink',
      'accessories': 'Accessories',
      'saleStatus': 'SaleStatus',
      'customerPrice': 'CustomerPrice',
      'rebate': 'Rebate',
      'address': 'DealerStreetAddress',
      'latitude': 'Latitude',
      'longitude': 'Longitude',
      'title': 'Title',
      'tagLine': 'TagLine',
      'cylinders': 'Cylinders',
      'ImagesLastModified': 'PhotosLastModifiedon',
      'vehicleclass': 'VehicleClass',
      'InternetPlusAcc': 'InternetPlusAcc',
      'State': 'DealerState',
      'Zip Code': 'DealerZip',
      'Phone Number': 'DealerPhone',
      'Series Detail': 'SeriesDetail',
      'engine displacement': 'EngineSize',
      'Images Secure': 'ImagesSecure',
      'Location Name': 'DealerName',
      'Color Code': 'ColorCode',
      'Wholesale': 'Wholesale',
      'descriptionNoHtml': 'DescriptionNoHtml',
      'Model and Series': 'ModelAndSeries',
      'Custom Price 1': 'CustomPrice1',
      'PackageCode': 'PackageCode',
      'Custom Price 2': 'CustomPrice2',
      'Incentives': 'Incentives'
    };

    // Additional field mappings for vAuto specific fields
    const VAUTO_SPECIAL_MAPPINGS = {
      'internetPrice': 'InternetReduced', // Map internetPrice to InternetReduced for consistency
      'retail': 'InternetSpecial', // Map retail to InternetSpecial for consistency
      'newUsed': 'Condition', // Map newUsed to Condition (U = Used, N = New)
      'cpo': 'Certified', // Map cpo to Certified
      'mpgCity': 'CityMPG', // Map mpgCity to CityMPG
      'mpgHighway': 'HighwayMPG', // Map mpgHighway to HighwayMPG
      'engine displacement': 'EngineSize', // Map engine displacement to EngineSize
      'Images Secure': 'ImagesSecure', // Map Images Secure to ImagesSecure
      'Location Name': 'DealerName', // Map Location Name to DealerName
      'Phone Number': 'DealerPhone', // Map Phone Number to DealerPhone
      'Zip Code': 'DealerZip', // Map Zip Code to DealerZip
      'State': 'DealerState' // Map State to DealerState
    };

    // Convert field names to camelCase
    const toCamelCase = str =>
      str
        .replace(/[^a-zA-Z0-9 ]+/g, '')
        .trim()
        .split(/\s+/)
        .map((word, i) =>
          i === 0
            ? word.toLowerCase()
            : word[0].toUpperCase() + word.slice(1).toLowerCase()
        )
        .join('');

    // First, normalize vAuto fields to standard format
    const normalizedRaw = {};
    for (let [key, value] of Object.entries(raw)) {
      if (VAUTO_FIELD_MAPPING[key]) {
        normalizedRaw[VAUTO_FIELD_MAPPING[key]] = value;
      } else if (VAUTO_SPECIAL_MAPPINGS[key]) {
        normalizedRaw[VAUTO_SPECIAL_MAPPINGS[key]] = value;
      } else {
        normalizedRaw[key] = value;
      }
    }

    // Handle special vAuto field transformations
    if (normalizedRaw.Condition === 'U') {
      normalizedRaw.Condition = 'Used';
    } else if (normalizedRaw.Condition === 'N') {
      normalizedRaw.Condition = 'New';
    }

    // Handle vAuto specific price mappings
    if (normalizedRaw.InternetSpecial && !normalizedRaw.InternetReduced) {
      normalizedRaw.InternetReduced = normalizedRaw.InternetSpecial;
    }
    if (normalizedRaw.InStorePrice && !normalizedRaw.InternetSpecial) {
      normalizedRaw.InternetSpecial = normalizedRaw.InStorePrice;
    }

    // Handle vAuto dealer information mapping
    if (!normalizedRaw.DealerName) {
      normalizedRaw.DealerName = normalizedRaw.LocationName || 'Unknown Dealer';
    }
    if (!normalizedRaw.DealerPhone) {
      normalizedRaw.DealerPhone = normalizedRaw.PhoneNumber || '';
    }
    if (!normalizedRaw.DealerState) {
      normalizedRaw.DealerState = normalizedRaw.State || '';
    }
    if (!normalizedRaw.DealerZip) {
      normalizedRaw.DealerZip = normalizedRaw.ZipCode || '';
    }

    // Handle vAuto engine size mapping
    if (normalizedRaw.EngineSize && !normalizedRaw.EngineDescription) {
      normalizedRaw.EngineDescription = normalizedRaw.EngineSize;
    }
    if (normalizedRaw.EngineDisplacement && !normalizedRaw.EngineSize) {
      normalizedRaw.EngineSize = normalizedRaw.EngineDisplacement;
    }

    // Handle vAuto MPG mapping
    if (normalizedRaw.MpgCity && !normalizedRaw.CityMPG) {
      normalizedRaw.CityMPG = normalizedRaw.MpgCity;
    }
    if (normalizedRaw.MpgHighway && !normalizedRaw.HighwayMPG) {
      normalizedRaw.HighwayMPG = normalizedRaw.MpgHighway;
    }

    // Handle vAuto seating capacity mapping
    if (normalizedRaw.Seats && !normalizedRaw.SeatingCapacity) {
      normalizedRaw.SeatingCapacity = normalizedRaw.Seats;
    }

    // Handle vAuto condition mapping
    if (normalizedRaw.NewUsed && !normalizedRaw.Condition) {
      normalizedRaw.Condition = normalizedRaw.NewUsed;
    }

    // Handle vAuto fuel type mapping
    if (normalizedRaw.Fuel && !normalizedRaw.FuelType) {
      normalizedRaw.FuelType = normalizedRaw.Fuel;
    }

    // Handle vAuto drive type mapping
    if (normalizedRaw.Drive && !normalizedRaw.DriveTrain) {
      normalizedRaw.DriveTrain = normalizedRaw.Drive;
    }


    for (let [key, value] of Object.entries(normalizedRaw)) {
      // Skip if value is empty
      if (value === '' || value === null || value === undefined) {
        continue;
      }

      const cleanKey = toCamelCase(key);
      
      // Handle numeric fields first
      if (NUMERIC_FIELDS.includes(cleanKey)) {
        const numericValue = this.parseNumericValue(value, INTEGER_FIELDS.includes(cleanKey));
        if (numericValue !== null) {
          out[cleanKey] = numericValue;
          continue;
        }
      }
      out['uploaded_from'] = 'autopulse.com';
      
      // Set source based on dealer website URL
      const dealerId = normalizedRaw.DealerID || '67bcec4d692b0c6a718e3da9';
      const dealerWebsite = dealerMap ? dealerMap.get(dealerId) : '';
      out['source'] = dealerWebsite || 'drivecarlux.com';
      out['dealerwebsiteurl'] = dealerWebsite || 'drivecarlux.com';
      
      // Log dealer ID mapping for debugging
      if (normalizedRaw.DealerID) {
        //console.log(`Mapping accountId to dealerId: ${normalizedRaw.DealerID} -> ${dealerId}`);
      }
      // Special case: photoUrls -> imagesSecure, pipe-separated
      if (cleanKey === 'photourls' && typeof value === 'string') {
        out['photourls'] = value;
        const delimiter = value.includes('|') ? '|' : ',';
        out['imagesSecure'] = value.split(delimiter).map(v => v.trim()).filter(Boolean);
        continue;
      }

      // Special case: imageUrls -> imagesSecure, pipe-separated (vAuto format)
      if (cleanKey === 'imageurls' && typeof value === 'string') {
        out['imageurls'] = value;
        const delimiter = value.includes('|') ? '|' : ',';
        out['imagesSecure'] = value.split(delimiter).map(v => v.trim()).filter(Boolean);
        continue;
      }

      if (cleanKey === 'inventoryUrl' && typeof value === 'string') {
        out['inventoryUrl'] = value;
        const shortId = nanoid(8);
        out['shortUrl'] = `https://autopulse.ai/v/${shortId}`;
        out['shortCode'] = shortId;
        continue;
      }

      // Handle vAuto vehicleUrl field
      if (cleanKey === 'vehicleurl' && typeof value === 'string') {
        out['inventoryUrl'] = value;
        const shortId = nanoid(8);
        out['shortUrl'] = `https://autopulse.ai/v/${shortId}`;
        out['shortCode'] = shortId;
        continue;
      }

      // Handle array fields
      if (
        ['imageUrls', 'options', 'imagesSecure', 'photoUrls', 'highValueFeatures', 'imageurls', 'photourls']
          .includes(cleanKey) &&
        typeof value === 'string'
      ) {
        const delimiter = value.includes('|') ? '|' : ',';
        out[cleanKey] = value.split(delimiter).map(v => v.trim()).filter(Boolean);
        continue;
      }

      // Date fields
      if (
        ['age', 'imagesLastModified', 'purchaseDate', 'lastModifiedDate', 'imagesLastModifiedon', 'photosLastModifiedon']
          .includes(cleanKey)
      ) {
        const dateValue = this.parseDateValue(value);
        if (dateValue !== null) {
          out[cleanKey] = dateValue;
          continue;
        }
      }

      // Boolean fields
      if (
        ['isCertified', 'carfax1Owner', 'carfaxCleanTitle', 'certified', 'cpo']
          .includes(cleanKey)
      ) {
        out[cleanKey] = this.parseBooleanValue(value);
        continue;
      }

      // Default: store as string with trimming
      out[cleanKey] = typeof value === 'string' ? value.trim() : value;
    }
    //console.log('Normalized raw data:', normalizedRaw)
    // Enforce dealerId
    out.dealerId = normalizedRaw.DealerID || '67bcec4d692b0c6a718e3da9';
    //console.log(`Final dealerId assigned: ${out.dealerId} (from DealerID: ${normalizedRaw.DealerID})`);
    
    // Add timestamp
    out.importedAt = new Date();
    
    return out;
  }

  parseNumericValue(value, isInteger = false) {
    if (typeof value === 'number') {
      return isInteger ? Math.round(value) : value;
    }
    
    if (typeof value === 'string') {
      // Remove currency symbols, thousands separators, etc.
      const cleaned = value
        .replace(/[^\d.-]/g, '') // Remove all non-numeric chars except . and -
        .replace(/(\..*)\./g, '$1'); // Remove multiple decimal points
      
      if (cleaned === '' || cleaned === '-') {
        return null;
      }
      
      const numericValue = parseFloat(cleaned);
      if (!isNaN(numericValue)) {
        return isInteger ? Math.round(numericValue) : numericValue;
      }
    }
    
    return null;
  }

  parseDateValue(value) {
    if (value instanceof Date) {
      return value;
    }
    
    if (typeof value === 'string') {
      // Try parsing various date formats
      const parsedDate = new Date(value);
      if (!isNaN(parsedDate.getTime())) {
        return parsedDate;
      }
      
      // Handle common date formats
      const formats = [
        'MM-DD-YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD',
        'MM-DD-YY', 'MM/DD/YY', 'DD-MM-YYYY'
      ];
      
      for (const format of formats) {
        const momentDate = moment(value, format);
        if (momentDate.isValid()) {
          return momentDate.toDate();
        }
      }
    }
    
    return null;
  }

  parseBooleanValue(value) {
    if (typeof value === 'boolean') {
      return value;
    }
    
    if (typeof value === 'number') {
      return value !== 0;
    }
    
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      return normalized === 'true' || 
             normalized === 'yes' || 
             normalized === '1' ||
             normalized === 'certified';
    }
    
    return false;
  }
}

// File-walker for CSV import
export const processDealerCSVFiles = async () => {
  await ensureDb();
  const uploadDir = path.join(process.cwd(), 'public/csv/upload');
  const processedDir = path.join(process.cwd(), 'public/csv/processed');

  await fs.promises.mkdir(processedDir, { recursive: true });
  const files = await processCSVFiles(uploadDir);
  const svc = new VehicleImportService();

  let total = 0;
  for (const file of files) {
    try {
      total += await svc.importFromCSV(path.join(uploadDir, file));
      await moveProcessedFile(
        path.join(uploadDir, file),
        path.join(processedDir, `${Date.now()}_${file}`)
      );
    } catch (error) {
      console.error(`Error processing file ${file}:`, error);
      // Move failed files to a separate directory
      await fs.promises.mkdir(path.join(processedDir, 'failed'), { recursive: true });
      await moveProcessedFile(
        path.join(uploadDir, file),
        path.join(processedDir, 'failed', `${Date.now()}_${file}`)
      );
    }
  }
  return { filesProcessed: files.length, rowsImported: total };
};