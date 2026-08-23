<?php
 
namespace App\Http\Controllers;

use Illuminate\View\View;

use Illuminate\Http\Request;
use GuzzleHttp\Client;
use App\Http\Traits\ApiResponseTrait;
use  Illuminate\Http\Response;
use App\Services\MarketcheckApiClient;
use Illuminate\Support\Facades\Auth;
use Stevebauman\Location\Facades\Location;
use App\Models\ChatSetting;
use App\Models\Conversation;
use App\Models\Dealer;
use App\Models\DealerSource;
use App\Mail\ManagerReviewNotification;
use App\Services\SmsService;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Log;

class ChatController extends Controller
{

    protected $marketcheckApiClient;
    protected $smsService;

    public function __construct(MarketcheckApiClient $marketcheckApiClient, SmsService $smsService)
    {
        $this->marketcheckApiClient = $marketcheckApiClient;
        $this->smsService = $smsService;
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

    public function index(Request $request)
    {
        $client = new Client();
        $headers = [
            'Content-Type' => 'application/json'
        ];
        $ipAddress = $this->get_client_ip();
       // $ipAddress  ='104.174.125.138';
        // Decode the JSON payload from the request
        $bodyData = [
            'request' => $request->input('request'),
            'context' => $request->input('context', ''),
            'conversation_id' => $request->input('conversation_id', ''),
            'ip' => $ipAddress,
            // Customer information from forms
            'customer_name' => $request->input('customer_name', ''),
            'customer_email' => $request->input('customer_email', ''),
            'customer_phone' => $request->input('customer_phone', ''),
            'booking_date' => $request->input('booking_date', ''),
            'booking_time' => $request->input('booking_time', ''),
            'booking_id' => $request->input('booking_id', ''),
            // Page information
            'current_url' => $request->input('current_url', ''),
            'page_title' => $request->input('page_title', ''),
            'referrer' => $request->input('referrer', ''),
            'user_agent' => $request->input('user_agent', ''),
        ];

       
       
        $dealerid = $request['dealerId']??'';
        if($dealerid)
            $chatbotSetting = ChatSetting::where('uuid', $dealerid)->first();
        
         
        $dealer_id = $chatbotSetting->dealer_id;
    
        $dealer = Dealer::where('id',$dealer_id)->first();
        $dealersource = DealerSource::where('dealer_id',$dealer_id)->first();
        #$dealersource->cancelled_at ='2010-10-10';
            // dd( $dealersource );
        if($dealersource->is_subscribed && (!($dealersource->cancelled_at) || (\Carbon\Carbon::now()->lessThanOrEqualTo(\Carbon\Carbon::parse($dealersource->cancelled_at)) ))){
                 
             
            $mylocation =['dealersouce'=>$chatbotSetting->dealership_url ??'','chatbotname'=>$chatbotSetting->chatbot_name ??'','dealership_name'=>$chatbotSetting->dealership_name ??''];
        
            $bodyData= array_merge($bodyData,   $mylocation);
            $bodyData['customer_id'] = $request->customerId;
            $bodyData['dealer_id'] = $dealer_id;
            
            $body = json_encode($bodyData);
        
            $this->marketcheckApiClient->log(env('CHAT_BOT_SERVER_URL'), $body, [], 'chat');
            $res = $client->post(env('CHAT_BOT_SERVER_URL'), [
                'headers' => $headers,
                'body' => $body
            ]);
            $response = json_decode($res->getBody()->getContents(),true);
            $response['weburl'] = str_replace(['"', "'"], '', $response['weburl']);
            $weburl = str_replace('https://chat.autopulse.ai', url('/api/vehicle'), $response['weburl']);
            $weburl.= '&source='.$chatbotSetting->dealership_url ??'';
            if(isset($response['RecordFound']) && $response['RecordFound'] =='Yes'){
                $vehicle = $response['vehicle'];
                $html = view('template.chatcar', compact('vehicle','weburl'))->render();
                unset($vehicle);
                $response['html'] =$html;
            }else{
                
                $response['html'] ='';
            
            }
            if($request->customerId){
                Conversation::where('conversation_id', $request->conversation_id)
                ->update(['user_id' => $request->customerId]);
            }
            #$response['manager_review'] = true;
            #dd($response);
            if( isset($response['manager_review']) && ($response['manager_review'])){
                $manager_email = $chatbotSetting->managerial_contact_email;
                $manager_phone = $chatbotSetting->managerial_contact_phone;
                $userQuery = $request->input('request', '');
                $conversationId = $request->input('conversation_id', '');
                $chatbotId = $chatbotSetting->uuid ?? $dealerid;
                $dealerName = $chatbotSetting->dealership_name ?? 'Unknown Dealership';

                // Send email notification to manager
                if ($manager_email) {
                    try {
                        Mail::to($manager_email)->send(new ManagerReviewNotification(
                            $userQuery,
                            $chatbotId,
                            $dealerName,
                            $conversationId
                        ));
                        
                        Log::info('Manager review email sent successfully', [
                            'email' => $manager_email,
                            'conversation_id' => $conversationId,
                            'chatbot_id' => $chatbotId
                        ]);
                    } catch (\Exception $e) {
                        Log::error('Failed to send manager review email', [
                            'email' => $manager_email,
                            'error' => $e->getMessage(),
                            'conversation_id' => $conversationId
                        ]);
                    }
                }

                // Send SMS notification to manager
                if ($manager_phone) {
                    try {
                        /*$smsSent = $this->smsService->sendManagerReviewSms(
                            $manager_phone,
                            $userQuery,
                            $chatbotId,
                            $dealerName,
                            $conversationId
                        );
                        
                        if ($smsSent) {
                            Log::info('Manager review SMS sent successfully', [
                                'phone' => $manager_phone,
                                'conversation_id' => $conversationId,
                                'chatbot_id' => $chatbotId
                            ]);
                        }*/
                    } catch (\Exception $e) {
                        Log::error('Failed to send manager review SMS', [
                            'phone' => $manager_phone,
                            'error' => $e->getMessage(),
                            'conversation_id' => $conversationId
                        ]);
                    }
                }

                // Log manager review requirement
                Log::info('Manager review required for conversation', [
                    'conversation_id' => $conversationId,
                    'chatbot_id' => $chatbotId,
                    'dealer_name' => $dealerName,
                    'user_query' => $userQuery,
                    'email_sent' => !empty($manager_email),
                    'sms_sent' => !empty($manager_phone)
                ]);
            }
            //$response['booking_enable'] = 1;
            $response['request_body'] = $body;
            unset($response['apiurl']);

            return response()->json($response);
        }else{
            return response()->json(['rawoutput'=>'You are not subscribed', 'response'=>'Not subscribed']);
        }
    }

    public function view(Request $request)
    {
        return view('template.users.chat');
    }

    public function removeZipParameter($url) {
        // Parse the URL and its query string
        $parsed_url = parse_url($url);
        
        // Parse the query string into an associative array
        parse_str($parsed_url['query'], $query_params);
        
        // Remove the 'zip' parameter
        if(isset($query_params['zip']))
            unset($query_params['zip']);
        
        // Build the new query string without 'zip'
        $new_query_string = http_build_query($query_params);
        
        // Rebuild the URL with the new query string
        $new_url = $parsed_url['scheme'] . '://' . $parsed_url['host'] . $parsed_url['path'];
        
        if (!empty($new_query_string)) {
            $new_url .= '?' . $new_query_string;
        }
        
        return $new_url;
    }
  
   
}