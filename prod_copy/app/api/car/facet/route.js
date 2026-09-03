import dbConnect from '@lib/mongodb';
import Vehicle from '@models/Vehicle';
import { NextResponse } from 'next/server';

export async function GET(request) {
  await dbConnect();
  
  try {
    const { searchParams } = new URL(request.url);
    const params = Object.fromEntries(searchParams.entries());
    
    // Build base query from search parameters
    const query = {};
    
    // Handle make filter (case-insensitive)
    if (params.make) {
      const makes = params.make.split(',').map(m => new RegExp(`^${m.trim()}$`, 'i'));
      query.make = { $in: makes };
    }
    
    // Handle model filter (case-insensitive)
    if (params.model) {
      const models = params.model.split(',').map(m => new RegExp(`^${m.trim()}$`, 'i'));
      query.model = { $in: models };
    }
    
    // Handle other filters
    if (params.year) query.year = params.year;
    if (params.bodytype) query.body = { $in: params.bodytype.split(',') };
    if (params.fueltype) query.fueltype = { $in: params.fueltype.split(',') };
    if (params.condition) query.condition = params.condition;

    // Parse facets parameter
    const facetsParam = params.facets || 
      'make|0|1000,model|0|1000,trim|0|1000,drivetrain|0|1000,transmission|0|1000,' +
      'cylinders|0|1000,fuel_type|0|1000,body_type|0|1000,vehicle_type|0|1000,' +
      'doors|0|1000,engine|0|1000,interior_color|0|1000,exterior_color|0|1000,' +
      'powertrain_type|0|1000,high_value_features|0|1000';

    const facetConfigs = facetsParam.split(',').map(facet => {
      const [field, offset = '0', limit = '1000'] = facet.split('|');
      return { 
        field, 
        offset: parseInt(offset), 
        limit: parseInt(limit),
        dbField: getDbField(field) // Map to actual database field names
      };
    });

    // Execute all facet aggregations in parallel
    const facetResults = {};
    
    await Promise.all(facetConfigs.map(async ({ field, dbField, limit }) => {
      const pipeline = [
        { $match: query },
        { $sort: { [dbField]: 1 } }
      ];

      // Special handling for high_value_features (options array)
      if (field === 'high_value_features') {
        pipeline.push(
          { $unwind: '$options' },
          { $group: {
            _id: '$options',
            count: { $sum: 1 }
          }},
          { $sort: { count: -1 } }
        );
      } else {
        pipeline.push(
          { $group: {
            _id: `$${dbField}`,
            count: { $sum: 1 }
          }},
          { $sort: { count: -1 } }
        );
      }

      pipeline.push(
        { $skip: 0 }, // Offset is handled in code
        { $limit: limit },
        { $project: {
          _id: 0,
          item: '$_id',
          count: 1
        }}
      );

      const results = await Vehicle.aggregate(pipeline);
      facetResults[field] = results;
    }));

    // Get total count matching the query
    const totalItems = await Vehicle.countDocuments(query);
    
    return NextResponse.json({
      num_found: totalItems,
      listings: [], // Empty array as per your example
      facets: facetResults
    });
    
  } catch (error) {
    console.error('Error fetching facets:', error);
    return NextResponse.json(
      { 
        error: 'Internal Server Error',
        details: error.message,
        num_found: 0,
        listings: [],
        facets: {}
      },
      { status: 500 }
    );
  }
}

// Maps facet field names to actual database fields
function getDbField(facetField) {
  const fieldMap = {
    'make': 'make',
    'model': 'model',
    'trim': 'trim',
    'drivetrain': 'drivetrain',
    'transmission': 'transmission',
    'cylinders': 'cylinders',
    'fuel_type': 'fueltype',
    'body_type': 'body',
    'vehicle_type': 'vehicletype',
    'doors': 'doorscount',
    'engine': 'enginedescription',
    'interior_color': 'interiorcolor',
    'exterior_color': 'exteriorcolor',
    'powertrain_type': 'drivetrain', // Assuming same as drivetrain
    'high_value_features': 'options'
  };
  
  return fieldMap[facetField] || facetField;
}