<?php
 
namespace App\Http\Controllers;
 
use App\Models\Lead;
use App\Models\User;
use App\Models\Dealer;
use App\Models\Favourite;   
use App\Models\Booking;
use App\Models\ConversionBooking;
use App\Models\DealerSource;
use Illuminate\View\View;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Arr;
use Illuminate\Support\Str;
;
use App\Http\Traits\ApiResponseTrait;
use  Illuminate\Http\Response;
use Validator;
use Illuminate\Validation\Rule;
use App\Jobs\SendLeadNotification;
use App\Jobs\SendLeadNotificationExpired;
use App\Models\ChatSetting;
use App\Services\MarketcheckApiClient;

 
class VisitController extends Controller
{
    use ApiResponseTrait;
   
    protected $marketcheckApiClient;

    public function __construct(MarketcheckApiClient $marketcheckApiClient)
    {
        $this->marketcheckApiClient = $marketcheckApiClient;
    }

    public function createUser($request){
       
        if($request->email){
            $finduser = User::where('email', $request->email)->first();
        }
        if($request->phone_number){
            if(!$finduser){
                $finduser = User::where('phone_number', $request->phone_number)->first();
            }
        }

        if($request['name']){
            $request['name'] =$request['name'];
        }else{
            $request['name'] =$request['first_name'].' '.$request['last_name'];
        }
        if(!$finduser){
           $finduser =  User::create(['dial_code'=>'+1','name'=>$request['name'],
           'email'=>$request['email'],'phone_number'=>$request['phone_number'],'zip_code'=>$request['zip_code'] ]);
        }
        return ['status'=> 1, 'data'=>$finduser]; 
        

    }

    public function makeFavouite(Request $request){
        $user = Auth::user();
        if($user){
            $fav = Favourite::where(['user_id'=>$user->id, 'vin'=>$request->vin])->first();
            if(!$fav){
                $status =1;
                $fav = Favourite::create(['user_id'=>$user->id, 'vin'=>$request->vin,'vid'=>$request->vid]);
            }else{
                $status =0;
                $fav->delete();
            }
            return $this->respondWithSuccess('User Login successfully',['status'=>$status],Response::HTTP_OK);
        }
        return $this->respondWithError('User Login successfully',$user,Response::HTTP_OK);
    }


    public function sendAdf(Request $request)
    {
        $dealerid = $request['dealerId']??'';
        if($dealerid)
            $chatbotSetting = ChatSetting::where('uuid', $dealerid)->first();
        $data  = $this->createUser($request);
        $vin_id = $request->vid;
        $user =  $data['data'];
        $systemdealer = Dealer::where('id',$chatbotSetting['dealer_id'])->first();
        
        if($user ){
            $vehicleData = [];
            if($vin_id){
            $vehicleData = $this->marketcheckApiClient->getListing($vin_id);
            }
            
            
                
                $vehicle = $vehicleData['listings'][0]??[];
                $data = ['user_id'=>$user->id,
                        'vid'=>$vehicle['id']??'',
                        'vin'=>$vehicle['vin']??'',
                        'dealer_external_id'=>0,
                        'dealer_source'=>$chatbotSetting['dealership_url']??'',
                        'dealer_id'=>$chatbotSetting['dealer_id']??'',
                        'viewed'=>0,
                        'store_id' => $chatbotSetting->store_id??'',
                        'make'=>$vehicle['build']['make']??'',
                        'model'=>$vehicle['build']['model']??'',
                        'trim'=>$vehicle['build']['trim']??'',
                        'transmission'=>$vehicle['build']['transmission']??'',
                        'drivetrain'=>$vehicle['build']['drivetrain']??'',
                        'price'=>$vehicle['price']??'',
                        'year'=>$vehicle['build']['year']??'',
                        'engine'=>$vehicle['build']['engine']??'',   
                        'body_type'=>$vehicle['build']['body_type']??'',
                        'miles'=>$vehicle['miles']??'',
                        'feature_image'=>$vehicle['media']['photo_links'][0]??''
                        ];

               
                   
                    $lead = Lead::create($data);
                    //$dealer = $vehicle['dealer'];
                    $dealer['dealership_name'] = $chatbotSetting['dealership_name'];
                    $dealer['phone'] = $systemdealer['phone']??'';
                    $dealer['email'] = $systemdealer['email'];
                    #if($vehicle){
                        $dealer['adf_mail'] = $chatbotSetting['adf_mail']??'ravikathait01@gmail.com';
                        //$dealer['adf_mail'] ='ravikathait01@gmail.com';
                        if($dealer['email']) SendLeadNotification::dispatch($user, $vehicle, $dealer);
                    #}
                   
               
            $lead['user_id'] = $user->id;
            return $this->respondWithSuccess('Lead Detail successfully',$lead,Response::HTTP_OK);
        }else{
            $user['user_id'] = $user->id;
            return $this->respondWithSuccess('User Login successfully',$user,Response::HTTP_OK);
        }
    }

    public function booking(Request $request)
    {

        $dealerid = $request['dealer_id']??'';
        if($dealerid)
            $chatbotSetting = ChatSetting::where('uuid', $dealerid)->first();
        $data  = $this->createUser($request);
        $vin_id = $request->vin;
        $user =  $data['data'];
        $systemdealer = Dealer::where('id',$chatbotSetting['dealer_id'])->first();
        
        if($user){
           
           
                $lead =Booking::where(['conversion_id'=>$request['conversion_id']])->first();
                if(!$lead){
                    
                    $data = ['name'=>$request->name,'email'=>$request->email, 'booking_date'=>$request->booking_date,
                        'booking_time'=>$request->booking_time,'user_id'=>$user->id,'dealer_id'=>$chatbotSetting->dealer_id,'conversion_id'=>$request->conversation_id,'phone'=>$request->phone_number,
                    ];
                   
                    $lead =Booking::create($data);

                    $mylead =ConversionBooking::create($data);
                }else{
                    $data =$lead->update( ['name'=>$request->name,'email'=>$request->email, 'booking_date'=>$request->booking_date,'conversion_id'=>$request->conversation_id,'phone'=>$request->phone_number,
                        'booking_time'=>$request->booking_time,'user_id'=>$user->id,'dealer_id'=>$chatbotSetting->dealer_id
                    ]);
                   
                }
                $dealer['dealership_name'] = $chatbotSetting['dealership_name'];
                $dealer['phone'] = $systemdealer['phone']??'';
                $dealer['email'] = $systemdealer['email'];
                $dealer['adf_mail'] = $chatbotSetting['adf_mail']??'ravikathait01@gmail.com';
                //$dealer['adf_mail'] ='ravikathait01@gmail.com';
                //if($dealer['email']) SendLeadNotification::dispatch($user, , $dealer);
                if($systemdealer['email']) {
                    $bookingPayload = [
                        'booking_date' => $request->booking_date ?? null,
                        'booking_time' => $request->booking_time ?? null,
                        'phone'        => $request->phone_number ?? null,
                        'conversion_id'=> $request->conversation_id ?? null,
                    ];
                    SendLeadNotification::dispatch($user, [], $dealer, $bookingPayload);
                }
               
            
            return $this->respondWithSuccess('Lead Detail successfully',$lead,Response::HTTP_OK);
        }else{
            $user['user_id'] = $user->id;
            return $this->respondWithError('User Login successfully',$user,Response::HTTP_OK);
        }
    }

    
}

