import dbConnect from '@lib/mongodb';
import Vehicle from '@models/Vehicle';
import User from '@models/User';
import { NextResponse } from 'next/server';

function calculateDom(lastModifiedDate) {
  if (!lastModifiedDate) return 0;
  const modifiedDate = new Date(lastModifiedDate);
  const now = new Date();
  const diffTime = Math.abs(now - modifiedDate);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function getPhotoLinks(doc) {
  if (doc.imagesSecure?.length) {
    return doc.imagesSecure;
  } else if (doc.photourls) {
    return doc.photourls.split('|');
  }
  return [];
}

// Helper function to create case-insensitive regex array
function createCaseInsensitiveFilters(value) {
  if (!value) return null;
  const values = value.split(',').map(v => v.trim());
  return values.map(val => new RegExp(`^${val}$`, 'i'));
}

export async function GET(request) {
  await dbConnect();
  
  try {
    const { searchParams } = new URL(request.url);
    
    // Pagination parameters
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    
    // Basic filters
    const dealerId = searchParams.get('dealer_id');
    const vin = searchParams.get('vin') || '';
    const make = searchParams.get('make') || '';
    const source = searchParams.get('source') || '';
    
    const model = searchParams.get('model') || '';
    const year = searchParams.get('year') || '';
    const stock = searchParams.get('stock') || '';
    const condition = searchParams.get('car_type') || '';
    
    // Advanced filters
    const engine = searchParams.get('engine') || '';
    const transmission = searchParams.get('transmission') || '';
    
    const exteriorColor = searchParams.get('exterior_color') || '';
    const interiorColor = searchParams.get('interior_color') || '';
    const bodyType = searchParams.get('body_type') || '';
    const fuelType = searchParams.get('fuel_type') || '';
    const priceRange = searchParams.get('price_range') || '';
    const yearRange = searchParams.get('year_range') || '';
    const milesRange = searchParams.get('miles_range') || '';
    const latitude = searchParams.get('latitude');
    const longitude = searchParams.get('longitude');
    const radius = searchParams.get('radius');
    const sortBy = searchParams.get('sortby') || '';
    const sortOrder = searchParams.get('sortorder') || 'desc';
    
    // Facets parameters
    const facets = searchParams.get('facets') || '';
    const facetFields = facets ? facets.split(',') : [];

    // Build the filter object
    const filter = {};
    
    // Basic filters
    if (dealerId) filter.dealerId = dealerId;
    if (vin) {
        // Handle both single VIN and comma-separated VINs
        const vins = vin.split(',').map(v => v.trim());
        filter.vin = vins.length > 1 ? { $in: vins } : vins[0];
        
    }
 
    // Case-insensitive filters for make, model, body_type, engine
    if (make) {
      const makeFilters = createCaseInsensitiveFilters(make);
      filter.make = { $in: makeFilters };
    }

    if (source) {
      
      filter.source = source;
    }
    
    if (model) {
      const modelFilters = createCaseInsensitiveFilters(model);
      filter.model = { $in: modelFilters };
    }
    
    if (stock) filter.stocknumber = { $regex: stock, $options: 'i' };
    if (year) filter.year = year;

    if (year) {
      const yearFilters = createCaseInsensitiveFilters(year);
      filter.year = { $in: yearFilters };
    }
    if (condition) {
        const conditionFilters = createCaseInsensitiveFilters(condition);
        filter.condition = { $in: conditionFilters };
    }
    
    // Advanced filters
    if (engine) {
      const engineFilters = createCaseInsensitiveFilters(engine);
      filter.enginedescription = { $in: engineFilters };
    }
    
    if (transmission) filter.transmission = { $in: transmission.split(',') };
    if (exteriorColor) filter.exteriorcolor = { $in: exteriorColor.split(',') };
    if (interiorColor) filter.interiorcolor = { $in: interiorColor.split(',') };
    
    if (bodyType) {
      const bodyTypeFilters = createCaseInsensitiveFilters(bodyType);
      filter.body = { $in: bodyTypeFilters };
    }
    
    if (fuelType) filter.fueltype = { $in: fuelType.split(',') };
    
    // Handle ranges (unchanged)
    if (priceRange) {
      const [min, max] = priceRange.split('-').map(Number);
      filter.internetreduced = { $gte: min, $lte: max };
    }
    
    if (yearRange) {
      const [min, max] = yearRange.split('-').map(Number);
      filter.year = { $gte: min, $lte: max };
    }
    
    if (milesRange) {
      const [min, max] = milesRange.split('-').map(Number);
      filter.mileage = { $gte: min, $lte: max };
    }
    console.log(filter)
    // Geo query (unchanged)
    if (latitude && longitude && radius) {
      filter.location = {
        $nearSphere: {
          $geometry: {
            type: 'Point',
            coordinates: [
              parseFloat(longitude),
              parseFloat(latitude)
            ]
          },
          $maxDistance: parseFloat(radius) * 1000
        }
      };
    }
    
    // Rest of the code remains exactly the same...
    // Build query options
    const options = {
      skip: (page - 1) * limit,
      limit: limit
    };
    
    // Sorting
    if (sortBy) {
      const sortDirection = sortOrder === 'asc' ? 1 : -1;
      
      switch (sortBy) {
        case 'price':
          options.sort = { internetreduced: sortDirection };
          break;
        case 'miles':
          options.sort = { mileage: sortDirection };
          break;
        case 'year':
          options.sort = { year: sortDirection };
          break;
        case 'msrp':
          options.sort = { instoreprice: sortDirection };
          break;
        case 'dom':
          options.sort = { lastmodifieddate: sortDirection };
          break;
        default:
          options.sort = { createdAt: -1 }; // Default sort
      }
    } else {
      options.sort = { createdAt: -1 }; // Default sort
    }
    
    // Get distinct dealers for dropdown
    const dealers = await Vehicle.distinct('dealerId');
    const dealerDetails = await User.find({ _id: { $in: dealers } }, 'name').lean();
    
    // Get facets if requested


    let facetResults = {};
    
    if (facetFields.length > 0) {
      for (const field of facetFields) {
        const [fieldName, limit = '10'] = field.split('|');
        
        const results = await Vehicle.aggregate([
          { $match: filter },
          { $group: { _id: `$${fieldName}`, count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: parseInt(limit) },
          { $project: { _id: 0, item: '$_id', count: 1 } }
        ]);
        
        facetResults[fieldName] = results;
      }
    }
    
    // Get vehicles
    const totalItems = await Vehicle.countDocuments(filter);
    const vehicles = await Vehicle.find(filter, null, {
      skip: (page - 1) * limit,
      limit: limit,
      sort: { createdAt: -1 }
    }).lean();

    // Transform vehicles to match your PHP structure
    const transformedVehicles = vehicles.map(doc => {
      // Get high value features
      const highValueFeatures = doc.options?.filter(opt => 
        /leather|navigation|sunroof|premium/i.test(opt)
      ) || [];

      // Build the listing object to match your PHP structure
      const listing = {
        id: doc.vin || '',
        is_certified: !!doc.certified,
        vin: doc.vin || '',
        heading: `${doc.year} ${doc.make} ${doc.model} ${doc.trim || ''}`,
        price: parseFloat(doc.internetreduced || 0),
        miles: parseInt(doc.mileage || 0),
        msrp: parseFloat(doc.instoreprice || 0),
        vdp_url: doc.inventoryUrl || '',
        carfax_1_owner: false,
        carfax_clean_title: false,
        exterior_color: doc.exteriorcolor || '',
        interior_color: doc.interiorcolor || '',
        dom: calculateDom(doc.lastmodifieddate),
        seller_type: doc.dealerId ? 'dealer' : 'private',
        inventory_type: doc.condition || 'used',
        source: doc.dealerwebsiteurl || '',
        media: {
          photo_links: getPhotoLinks(doc)
        },
        dealer: {
          id: doc.dealerId?.toString() || null,
          website: doc.dealerwebsiteurl || '',
          name: doc.dealername || '',
          dealer_type: '',
          street: doc.dealerstreetaddress || '',
          city: doc.dealercity || '',
          state: doc.dealerstate || '',
          country: 'US',
          latitude: doc.location?.coordinates?.[1] || 0,
          longitude: doc.location?.coordinates?.[0] || 0,
          zip: doc.dealerzip || '',
          phone: doc.dealerphone || ''
        },
        extra: {
          high_value_features: highValueFeatures
        },
        build: {
          year: parseInt(doc.year || 0),
          make: doc.make || '',
          model: doc.model || '',
          trim: doc.trim || '',
          body_type: doc.body || '',
          body_subtype: '',
          vehicle_type: doc.vehicletype || '',
          transmission: doc.transmission || '',
          drivetrain: doc.drivetrain || '',
          fuel_type: doc.fueltype || '',
          engine: doc.enginedescription || '',
          engine_size: ((doc.enginesize || '0')),
          engine_block: '',
          doors: parseInt(doc.doorscount || 0),
          cylinders: parseInt(doc.cylinders || 0),
          highway_mpg: parseInt(doc.highwaympg || 0),
          city_mpg: parseInt(doc.citympg || 0)
        }
      };

      return listing;
    });

    const totalPages = Math.ceil(totalItems / limit);
    
    return NextResponse.json({
      num_found: totalItems,
      listings: transformedVehicles,
      pagination: {
        currentPage: page,
        totalPages,
        totalItems,
        itemsPerPage: limit,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1
      }
    });
    
  } catch (error) {
    console.error('Error fetching vehicles:', error);
    return NextResponse.json(
      { 
        params: Object.fromEntries(searchParams.entries()),
        error: error.message,
        num_found: 0,
        listings: [],
        facets: []
      },
      { status: 500 }
    );
  }
}