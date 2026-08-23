<?php

namespace App\Services;

use GuzzleHttp\Client;

use App\Models\ApiLog;
use App\Models\Visit;
use App\Models\DealerSource;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class MarketcheckApiClient
{
    protected $baseUrl = 'https://www.autopulse.ai/';
   
    protected $client;
    protected $api_key;
    public $ip;

    public function __construct(Client $client)
    {
        $dealersourc = new DealerSource();
        $this->client = $client;
        $this->api_key = env('MARKETCHECK_API_KEY');
        
    }

    public function searchActiveCars($params)
    {
        
        //$params['api_key'] = $this->api_key;
        //$params['include_relevant_links'] = 'true';
        //$params['preferred_sources'] = $this->preffereredsource ;
        // dd($params);
            $filteredArray = array_filter($params, function ($value) {
                return $value !== null && $value !== '';
            });

        //return   $response = $this->openservice->searchCars($filteredArray);
        #dd( $params,$response);
        return $this->makeRequestnew('GET', 'api/car', $params);
    }

    public function searchFacets($params)
    {
        //$params['api_key'] = $this->api_key;
        
        //return $response = $this->openservice->searchWithFacets($params);
        // dd($response);
        #dd($params);
        $response = $this->makeRequestnew('GET', 'api/car/facet', $params);
        #dd($response);
        return ($response);
    }

    public function getListing($vin)
    {
        //$params['api_key'] = $this->api_key;
        //$params['vin'] = [$vin];
        #dd($params);
        return $this->makeRequestnew('GET', "api/car",['vin'=>$vin]);
    }

    public function getDealerSource($params)
    {
       
        //$params['api_key'] = $this->api_key;
        //return $response = $this->openservice->searchCars($params);
        return $this->makeRequest('get', 'api/car/', $params);
    }

    public function getPopularMakeModel($params, $home = 1)
    {
        $body = Visit::select('make', 'model', DB::raw('count(*) as total'))
        ->groupBy('make', 'model')
        ->orderBy('total', 'desc')
        ->limit(10)
        ->get();
        $k=0;
        if($body->count()<5){
            $body=[
                ['make' =>'Toyota' ,'model' =>'' ],
                ['make' =>'Honda' ,'model' =>'' ],
                ['make' =>'Ford' ,'model' =>'' ],
                ['make' =>'BMW' ,'model' =>'' ],
                ['make' =>'Jeep' ,'model' =>'' ],
                ['make' =>'Subaru' ,'model' =>'' ]
        ];
        }
        
        foreach ($body as $key => $value) {
            $row = ['sort_by' => 'dom', 'sort_order' => 'asc'];
            $row['make'] = $value['make'];
           // $row['car_type'] = $params['car_type'];
            $row['model'] = $value['model'];
            $filteredArray = array_filter($row, function ($value) {
                return $value !== null && $value !== '';
            });
            $response = $this->makeRequest('GET', 'search/car/active', $row);
             //$response = $this->openservice->searchCars($filteredArray);
             //dd( $response, $filteredArray);
            $data = $response;
            $row['data'] = $data;
            $popular[] = $row;

            if ($k > 5) {
                break;
            }
            $k++;
        }
        return $popular;
    }

    public function getPopularMakeModelOnly($params, $home = 1)
    {
        $body = Visit::select('make', 'model', DB::raw('count(*) as total'))
        ->groupBy('make', 'model')
        ->orderBy('total', 'desc')
        ->limit(10)
        ->get();
        $popularbrand = ['make' => [], 'model' => []];
        $k = 0;
        foreach ($body as $key => $value) {
            if (!in_array($value['make'], $popularbrand['make'])) {
                $popularbrand['make'][] = $value['make'];
            }
            $popularbrand['car_type'] = $params['car_type'];
            if (!in_array($value['model'], $popularbrand['model'])) {
                $popularbrand['model'][] = $value['model'];
            }
            if ($k > 10) {
                break;
            }
            $k++;
        }
        return $popularbrand;
    }

    protected function makeRequest($method, $endpoint, $params)
    {
        $responsePayload = null;
        $statusCode = null;
        try {
            $response = $this->client->request($method, $this->baseUrl . $endpoint, ['query' => $params]);
           
        } catch (\Exception $e) {
            //$responsePayload = ['error' => $e->getMessage()];
            //$statusCode = $e->getCode();
        }

        $this->log($endpoint, $params, [], 'web');
        if(isset($response)){
            return $body =json_decode($response->getBody()->getContents(), true);
        }else{
            return ['num_found'=>0,'listings'=>[]];

        }
       
    }

    protected function makeRequestnew($method, $endpoint, $params)
    {
        if(isset($params['car_type']) && count(explode(',',$params['car_type'])) >1){
            unset($params['car_type']);
        }else{

        }
        $responsePayload = null;
        $statusCode = null;
       
        try {
            $response = $this->client->request($method, $this->baseUrl . $endpoint, ['query' => $params]);
            //$responsePayload = json_decode($response->getBody()->getContents(), true);
            //$statusCode = $response->getStatusCode();
        } catch (\Exception $e) {
            //$responsePayload = ['error' => $e->getMessage()];
            //$statusCode = $e->getCode();
        }
       // dd( $response);
        $this->log($endpoint, $params, [], 'web');
        if(isset($response)){
            return $body =json_decode($response->getBody()->getContents(), true);
        }else{
            return ['num_found'=>0,'listings'=>[]];
        }
       
    }

    public function log($endpoint, $requestPayload, $responsePayload, $call_from='web')
    {
       /* ApiLog::create([
            'endpoint' => $endpoint,
            'request_payload' => json_encode($requestPayload),
            'call_from'=>$call_from,
            'ip_address' => $this->ip
        ]);*/
    }

   
    public function myweburl($url)
    {
        
        $response = $this->client->request('GET', $url,[]);
        return $body = json_decode($response->getBody()->getContents(), true);
    }

    public function client_ip() {
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

}
