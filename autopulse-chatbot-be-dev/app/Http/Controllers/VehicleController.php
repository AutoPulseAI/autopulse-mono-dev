<?php
 
namespace App\Http\Controllers;
use Illuminate\Pagination\LengthAwarePaginator;
use App\Models\User;
use Illuminate\View\View;
use App\Models\Visit;
use App\Models\clickCallSms;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Validator;
use Illuminate\Validation\Rule;
use App\Http\Traits\ApiResponseTrait;
use App\Services\MarketcheckApiClient;
use Illuminate\Support\Facades\Cache;
use Stevebauman\Location\Facades\Location;
use App\Models\Ads;
use App\Models\Dealer;
use App\Models\DealerSource;
use Illuminate\Support\Arr;

class VehicleController extends Controller
{
    use ApiResponseTrait;
    protected $marketcheckApiClient;

    public function __construct(MarketcheckApiClient $marketcheckApiClient)
    {
        $this->marketcheckApiClient = $marketcheckApiClient;
    }
   


    public function getAddress($input=[])
    {
        $geolocationData = session('geolocation');
        $ipAddress = $this->get_client_ip();
        $user = Auth::user();
        if(isset($input['latitude']) && !empty($input['latitude']) && !empty($input['longitude'])){
            $geolocationData = [
                
                'latitude' => $input['latitude'],
                'longitude' => $input['longitude'],
                'country' => $input['country']??'',
                'zipCode'=>$input['zip']??'',
                'state' => '',
                'city' => '',
                'cityName'=>'',
            ];
            session(['geolocation' => $geolocationData]);
        }else if($user ){
            if($user['country']='United States') $country ='US';
            
            $geolocationData = [ 
                'latitude' => $user['latitude'],
                'longitude' => $user['longitude'],
                'state' => $user['state'],
                'city' => $user['city'],
                'cityName'=>$user['city'],
                'zipCode'=>$user['zip_code'],
                'country' => $country,
            ];

            if(!isset($geolocationData['latitude']) || empty($geolocationData['latitude']) ){
               
                $position = Location::get($ipAddress);
               
                if ($position) {
                    $geolocationData = [
                        'ip' => $position->ip,
                        'latitude' => $position->latitude,
                        'longitude' => $position->longitude,
                        'country' => $position->countryCode,
                        'state' => $position->regionCode,
                        'city' => $position->areaCode,
                        'cityName'=>$position->cityName,
                        'zipCode'=>$position->zipCode,
                        //'country' => 'US',
                    ];
                }else{
                    $geolocationData = [
                        'ip' => $ipAddress,
                        'latitude' => '',
                        'longitude' => '',
                        'country' => '',
                        'state' => '',
                        'city' => '',
                        'cityName'=>'',
                        'zipCode'=>'',
                        //'country' => 'US',
                    ];
                }
            }
        } else{
          
            // Get the client's IP address from the request object
           if(!isset($geolocationData['latitude']) || empty($geolocationData['latitude']) ){
               
                $position = Location::get($ipAddress);
               
                if ($position) {
                    // Prepare data for storage in the session
                    $geolocationData = [
                        'ip' => $position->ip,
                        'latitude' => $position->latitude,
                        'longitude' => $position->longitude,
                        'country' => $position->countryCode,
                        'state' => $position->regionCode,
                        'city' => $position->areaCode,
                        'cityName'=>$position->cityName,
                        'zipCode'=>$position->zipCode,
                        //'country' => 'US',
                    ];
                }else{
                    $geolocationData = [
                        'ip' => $ipAddress,
                        'latitude' => '',
                        'longitude' => '',
                        'country' => '',
                        'state' => '',
                        'city' => '',
                        'cityName'=>'',
                        'zipCode'=>'',
                        //'country' => 'US',
                    ];
                }
            }
        }
      
        if($geolocationData['country']!='US'){
            $geolocationData = [
               
                'ip' => $ipAddress,
                'latitude' => '',
                'longitude' => '',
                'country' => '',
                'state' => '',
                'city' => '',
                'cityName'=>'',
                'zipCode'=>'',
            ];
        } 
        session(['geolocation' => $geolocationData]);
        return $geolocationData;
    }
    

    function get_client_ip() {
        $ipaddress = '';
        if (getenv('HTTP_CLIENT_IP'))
            $ipaddress = getenv('HTTP_CLIENT_IP');
        else if(getenv('HTTP_X_FORWARDED_FOR'))
            $ipaddress = getenv('HTTP_X_FORWARDED_FOR');
        else if(getenv('HTTP_X_FORWARDED'))
            $ipaddress = getenv('HTTP_X_FORWARDED');
        else if(getenv('HTTP_FORWARDED_FOR'))
            $ipaddress = getenv('HTTP_FORWARDED_FOR');
        else if(getenv('HTTP_FORWARDED'))
           $ipaddress = getenv('HTTP_FORWARDED');
        else if(getenv('REMOTE_ADDR'))
            $ipaddress = getenv('REMOTE_ADDR');
        else
            $ipaddress = 'UNKNOWN';
        return $ipaddress;
    }
    
    
    public function explodeSubarrays(&$array) {
        foreach ($array as $key => &$value) {
            if (is_array($value)) {
                $value = implode(',', $value);
            }    
        }
    }

   

    public function callSms(Request $request){
        $vin_id = $request->vin; 
        $action = $request->action;
        $vehicle = $this->marketcheckApiClient->getListing($vin_id);
      
        $ip = $this->get_client_ip();
        if($vehicle['dealer']['website']){
            $dealer_source=$vehicle['dealer']['website'];
            $dealersource =DealerSource::where('source',$dealer_source)->first(); 
            $store_id =NULL;
            if($dealersource){
                $dealer =Dealer::where('id',$dealersource->dealer_id)->first(); 
                $vehicle['dealer']['internal_id'] = $dealersource['dealer_id']??'0';
                $store_id = $dealersource['store_id']??NULL;
                $vehicle['dealer']['profile_pic'] = $dealer['profile_pic'] ??'';
                $vehicle['dealer']['name'] =$dealersource['dealership_name'] ;
                $vehicle['dealer']['phone'] =$dealersource['phone'] ;
                $vehicle['dealer']['street'] =$dealersource['address']?$dealersource['address']: $vehicle['dealer']['street'] ;
                $vehicle['dealer']['city'] =$dealersource['city'] ?$dealersource['city']: $vehicle['dealer']['city'] ;;
                $vehicle['dealer']['state'] =$dealersource['state'] ?$dealersource['state']: $vehicle['dealer']['state'] ;;
                $vehicle['dealer']['zip'] =$dealersource['zip_code'] ?$dealersource['zip_code']: $vehicle['dealer']['zip'] ;;
                $vehicle['dealer']['call_track_number'] =  $dealersource['call_track_number'] ?$dealersource['call_track_number']: '' ;;
            }
           
        }
        $carType = Arr::random(['new', 'old']);
        clickCallSms::create(['vid'=>$vehicle['id']??'NULL','vin'=>$vehicle['vin']??'NULL','source'=>$vehicle['dealer']['website']??'NULL','store_id' => $store_id,'dealer_id'=>$vehicle['dealer']['internal_id']??'NULL','user_id'=> $user_id??'NULL','ip' =>$ip,'type'=>$action,
            'make'=>$vehicle['build']['make'],
            'model'=>$vehicle['build']['model'],
            'trim'=>$vehicle['build']['trim'],
            'transmission'=>$vehicle['build']['transmission'],
            'drivetrain'=>$vehicle['build']['drivetrain'],
            'price'=>$vehicle['price'],
            'year'=>$vehicle['build']['year'],
            'engine'=>$vehicle['build']['engine'],   
            'body_type'=>$vehicle['build']['body_type'],
            'miles'=>$vehicle['miles'],
            'car_type'=>$carType,
            'feature_image'=>$vehicle['media']['photo_links'][0]??''
        ]);
        return response()->json([]);
    }

    public function dependentKeyword(Request $request){
        $allmodel =   Cache::remember('all_brands_model_'.$request->make, now()->addDay(),function ()use ($request) { 
            $param = [];
            $all = $this->marketcheckApiClient->searchFacets(['facets'=>'model|0|1000','make'=>$request['make'],'rows'=>0, 'start'=>0]);
          
            return $all;
            
        });
        return response()->json($allmodel);
        
    }

    public function search(Request $request)
    {
        $input =  $request->all();
        if(isset($input['year_range'])&& !empty($input['year_range'])) {
            $allyear = explode('-',$input['year_range']);
            if($allyear[0]<1900){
                $allyear[0] =1900;
            }
            for($i = $allyear[0] ;$i <= $allyear[1]; $i++)
            $input['year'][] = $i;
        }
        if((isset($input['min']) && !empty($input['min'])) && (isset($input['max'])&& !empty($input['max']))){
            $input['price_range'] = $input['min'].'-'.$input['max'];
        }else if((isset($input['min']) && !empty($input['min'])) && !(isset($input['max'])&& !empty($input['max']))){
            $input['price_range'] = $input['min'].'-10000000';
        }else if(!(isset($input['min']) && !empty($input['min'])) && (isset($input['max'])&& !empty($input['max']))){
            $input['price_range'] ='0-'.$input['max'];
        }
        if(isset($input['radius']) && $input['radius'] >500){
            $input['radius'] =500;
        }
        $exploded =$input;
       
        $getAdress = $this->getAddress($input);
        
        $this->explodeSubarrays($exploded);
        $params = $exploded;
       
        
        $params['start'] =0;
        $params['rows'] =0;
        $colorData = config('constants.COLOR');
             
        $inputValues = [
            'year' => $exploded['year'] ?? null,
            'latitude' => $input['latitude'] ?? null,
            'longitude' => $input['longitude'] ?? null,
            'radius' => $input['radius'] ?? null,
            'car_type' => $exploded['car_type'] ?? null,
            'make' => $exploded['make'] ?? null,
            'fuel_type' => $exploded['fuel_type'] ?? null,
            'body_type' => $exploded['body_type'] ?? null,
            'trim' => $exploded['trim'] ?? null,
            'transmission' => $exploded['transmission'] ?? null,
            'interior_color' => $exploded['interior_color'] ?? null,
            'exterior_color' => $exploded['exterior_color'] ?? null,
            'powertrain_type' => $exploded['powertrain_type'] ?? null,
            'high_value_features' => $exploded['high_value_features'] ?? null,
            'seating_capacity' => $exploded['seating_capacity'] ?? null,
            'drivetrain' => $exploded['drivetrain'] ?? null,
            'engine' => $exploded['engine'] ?? null,
            'model' => $exploded['model'] ?? null,
            'source' => $input['source'] ?? null
        ];  
        $inputparam = array_filter($inputValues) ;
        $finalvalue = $this->marketcheckApiClient->searchFacets($inputparam );
    
        
        $params['start'] =(isset($input['page'])?($input['page']*30 -30):0) ;
        $params['rows'] =30;
        //dd($params);
        if(isset($_REQUEST['Latest']) && !empty($_REQUEST['Latest'])){
            $params = array_merge($params, ['dom', 'sort_order' => 'asc', 'dom_range'=>'30-60']);
        }elseif(!isset($_REQUEST['sort_by'])){
            $input['sort_by'] ='relevence';
            $input['sort_order'] ='asc';
            $params = array_merge($params, ['sort_by' =>'relevence', 'sort_order' => 'asc']);
        }elseif(isset($_REQUEST['sort_by']) && empty($_REQUEST['sort_by'])){
            $input['sort_by'] ='relevence';
            $input['sort_order'] ='asc';
            $params = array_merge($params, ['sort_by' =>'relevence', 'sort_order' => 'asc']);
        }
        $vehiclelist = $this->marketcheckApiClient->searchActiveCars($params);

       # dd($finalvalue);
        $paginator = new LengthAwarePaginator(
            $vehiclelist['listings'],
            ($vehiclelist['num_found']>1500 ? 1500 : $vehiclelist['num_found']) ,
            30,
            ($params['start']+30)/30,
            ['path' => request()->url(), 'query' => request()->query()]
        );

        return response()->json([
            'html' => view('template.users.apicars', compact('finalvalue','input','paginator','colorData'))->render()
        ]);
       
    }

    public function getVehicleDetailApi( $vin)
    {
        $ip = $this->get_client_ip();
        $vin_id = $vin;
        $vehicle = $this->marketcheckApiClient->getListing($vin_id);
       
        
        return   response()->json($vehicle);
       
    }

   
}
