<?php 
namespace App\Http\Controllers\Admin;

use App\Models\Conversation;
use Illuminate\Http\Request;
use App\Http\Controllers\Controller;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use App\Models\ChatSetting;
use App\Models\DealerSource;
use App\Models\User;
class ConversationController extends Controller
{
    public function index(Request $request)
    {
      
       
        $query = Conversation::with('followUps','ConversionBooking') ->withCount([
                    'clicksVisitDealerWebsite',
                    'clicksViewVehicle',
                    'clicksVinRequestForm',
                    'clicksExploreMore',
                    'vinCopy',
                    'followUps',
                    'ConversionBooking'
                ]) 
                ->where(function ($q) {
                    $q->whereNull('followup_id')
                    ->orWhere('followup_id', ''); // Check for empty string
                });
                

                if ($request->filled('order_by_clicks') && !empty($request['order_by_clicks'])) {
                    switch ($request['order_by_clicks']) {
                        case 'followup_lead_desc':
                            $query->orderBy('follow_ups_count', 'desc');
                            break;

                        case 'followup_lead_asc':
                            $query->orderBy('follow_ups_count', 'asc');
                            break;
                            
                        case 'clicks_visit_dealer_website_count_desc':
                            $query->orderBy('clicks_visit_dealer_website_count', 'desc');
                            break;
                        case 'clicks_visit_dealer_website_count_asc':
                            $query->orderBy('clicks_visit_dealer_website_count', 'asc');
                            break;
                        case 'clicks_view_vehicle_count_desc':
                            $query->orderBy('clicks_view_vehicle_count', 'desc');
                            break;
                        case 'clicks_view_vehicle_count_asc':
                            $query->orderBy('clicks_view_vehicle_count', 'asc');
                            break;
                        case 'clicks_vin_request_form_count_desc':
                            $query->orderBy('clicks_vin_request_form_count', 'desc');
                            break;
                        case 'clicks_vin_request_form_count_asc':
                            $query->orderBy('clicks_vin_request_form_count', 'asc');
                            break;
                        case 'clicks_explore_more_count_desc':
                            $query->orderBy('clicks_explore_more_count', 'desc');
                            break;
                        case 'clicks_explore_more_count_asc':
                            $query->orderBy('clicks_explore_more_count', 'asc');
                            break;
                        case 'vin_copy_count_desc':
                            $query->orderBy('vin_copy_count', 'desc');
                            break;
                        case 'vin_copy_count_asc':
                            $query->orderBy('vin_copy_count', 'asc');
                            break;
                        default:
                            $query->orderBy('request_timestamp', 'desc');
                            break;
                    }
                    $query->orderBy('clicks_visit_dealer_website_count', 'desc');
                } else {
                    // Default ordering
                    $query->orderBy('request_timestamp', 'desc');
                }
            

        if ($request->filled('from')) {
            $query->whereDate('request_timestamp', '>=', $request->from);
        }

        if ($request->filled('to')) {
            $query->whereDate('request_timestamp', '<=', $request->to);
        }
        

        // Filter based on dealersource in request JSON
        if ($request->filled('dealersource')) {
            $query->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(request, '$.dealersouce')) = ?", [$request->dealersource]);
        }else{
            $query->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(request, '$.dealership_name')) != ?", ['autopulse.ai']);
        }
        #dd($query->toSql(),$request->dealersource);
       // $query->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(request, '$.dealersouce')) = ?", [$chatbotSetting->dealership_url]);

        // Paginate the results
        $conversations = $query->paginate(10)->appends([
            'from' => $request->get('from'),
            'to' => $request->get('to'),
            'order_by_clicks' => $request->get('order_by_clicks'),
            'dealersource' => $request->get('dealersource'),
        ]);
       
        #dd( $conversations);
        // Format conversations and include follow-ups
        $formattedConversations = $conversations->map(function ($conversation) {
            // Decode the JSON in the 'request' and 'response' fields
            $validJsonString = $conversation->request;
            $validresponseJsonString = str_replace(["'", "None"], ['"', 'null'], $conversation->response);

            $request = json_decode($validJsonString, true);
            $response = json_decode($validresponseJsonString, true);
            $additionalInfoString = json_decode($conversation->additional_info,true);
            $additionalInfoJson = json_decode($additionalInfoString['response'], true);
            #dd($additionalInfoJson );
            // Extract values from response/additional_info
            $heading = $additionalInfoJson['heading'] ?? 'N/A';
            $subheading = $additionalInfoJson['subheading'] ?? 'N/A';
            $paragraphs = $additionalInfoJson['paragraphs'] ?? [];
            $listItems = $additionalInfoJson['list'] ?? [];

            $country = $request['country'] ?? 'N/A';
            $zipcode = $request['zip'] ?? 'N/A';
            $query = $request['request'] ?? 'N/A';
            $context = $request['context'] ?? 'N/A';
            $dealership_name = $request['dealership_name'] ?? 'N/A';
            $recordFound = $response['RecordFound'] ?? 'No';
            $apiurl = $response['apiurl'] ?? 'N/A';
            $user=[];
            if($conversation->user_id){
                $user = User::where('id',$conversation->user_id)->first()->toArray();
            }

            $followUps = $conversation->followUps->map(function ($followUp) {
                $validFollowUpRequestJson = $followUp->request;
                $validFollowUpResponseJson = str_replace(["'", "None"], ['"', 'null'], $followUp->response);
    
                $followUpRequest = json_decode($validFollowUpRequestJson, true);
                $followUpResponse = json_decode($validFollowUpResponseJson, true);
                $additionalInfoString = json_decode($followUp->additional_info,true);
                $additionalInfoJson = json_decode($additionalInfoString['response'], true);
                
                // Extract values from response/additional_info
                $heading = $additionalInfoJson['heading'] ?? 'N/A';
                $subheading = $additionalInfoJson['subheading'] ?? 'N/A';
                $paragraphs = $additionalInfoJson['paragraphs'] ?? [];
                $listItems = $additionalInfoJson['list'] ?? [];
                // Extract follow-up fields from JSON
               
                return [
                    'conversation_id' => $followUp->conversation_id,
                    
                    'dealership_name' => $followUpRequest['dealership_name'] ?? 'N/A',
                    'query' => $followUpRequest['request'] ?? 'N/A',
                    'context' => $followUpRequest['context'] ?? 'N/A',
                    'country' => $followUpRequest['country'] ?? 'N/A',
                    'zipcode' => $followUpRequest['zip'] ?? 'N/A',
                    'recordFound' => $followUpResponse['RecordFound'] ?? 'No',
                    'apiurl' => $followUpResponse['apiurl'] ?? 'N/A',
                    'request_timestamp' => $followUp->request_timestamp,
                   
                   
                    'additional_info' => [
                        'heading' => $heading,
                        'subheading' => $subheading,
                        'paragraphs' => $paragraphs,
                        'listItems' => $listItems,
                        
                    ],
                   
                ];
            });

            // Return the formatted conversation with follow-ups
            return [
                'conversation_id' => $conversation->conversation_id,
                'user_id'=>$conversation->user_id,
                'user'=>$user,
                'dealership_name' => $dealership_name,
                'query' => $query,
                'context' => $context,
                'country' => $country,
                'zipcode' => $zipcode,
                'recordFound' => $recordFound,
                'apiurl' => $apiurl,
                'request_timestamp' => $conversation->request_timestamp,
                'additional_info' => $conversation->additional_info,
                'clicks_visit_dealer_website_count'=>$conversation->clicks_visit_dealer_website_count,
                'clicks_view_vehicle_count'=>$conversation->clicks_view_vehicle_count,
                'clicks_vin_request_form_count'=>$conversation->clicks_vin_request_form_count,
                'clicks_explore_more_count'=>$conversation->clicks_explore_more_count,
                'clicks_vin_copy_count'=>$conversation->vin_copy_count,
                'session_timing' => $conversation->time_diff,
                'additional_info' => [
                    'heading' => $heading,
                    'subheading' => $subheading,
                    'paragraphs' => $paragraphs,
                    'listItems' => $listItems,
                ],
                'follow_ups' => $followUps, // Include follow-ups in the result
                'conversion_booking'=>$conversation->ConversionBooking->toArray(),
            ];
        });
        #dd($formattedConversations);
        // Pass the formatted data to the view
        $stores = ChatSetting::all();
        return view('template.admin.conversations', [
            'conversations' => $formattedConversations,
            'from' => $request->from,
            'to' => $request->to,
            'pagination' => $conversations,
            'dealers' => $stores
        ]);
        #return view('template.admin.conversations', compact('conversations'));
    }

    public function dealerConversion(Request $request)
    {
        $dealer = Auth::guard('dealer')->user();
        $chatbotSetting = ChatSetting::where('dealer_id', $dealer->id)->first();
        // dd( $chatbotSetting );
        //$chatbotSetting->dealership_url='billionauto.com';
                $query = Conversation::with('followUps','ConversionBooking') ->withCount([
                    'clicksVisitDealerWebsite',
                    'clicksViewVehicle',
                    'clicksVinRequestForm',
                    'clicksExploreMore',
                    'vinCopy',
                    'followUps',
                    'ConversionBooking'
                ]) 
                ->where(function ($q) {
                    $q->whereNull('followup_id')
                    ->orWhere('followup_id', ''); // Check for empty string
                });
                if ($request->filled('order_by_clicks') && !empty($request['order_by_clicks'])) {
                    switch ($request['order_by_clicks']) {
                        case 'followup_lead_desc':
                            $query->orderBy('follow_ups_count', 'desc');
                            break;

                        case 'followup_lead_asc':
                            $query->orderBy('follow_ups_count', 'asc');
                            break;
                        case 'clicks_visit_dealer_website_count_desc':
                            $query->orderBy('clicks_visit_dealer_website_count', 'desc');
                            break;
                        case 'clicks_visit_dealer_website_count_asc':
                            $query->orderBy('clicks_visit_dealer_website_count', 'asc');
                            break;
                        case 'clicks_view_vehicle_count_desc':
                            $query->orderBy('clicks_view_vehicle_count', 'desc');
                            break;
                        case 'clicks_view_vehicle_count_asc':
                            $query->orderBy('clicks_view_vehicle_count', 'asc');
                            break;
                        case 'clicks_vin_request_form_count_desc':
                            $query->orderBy('clicks_vin_request_form_count', 'desc');
                            break;
                        case 'clicks_vin_request_form_count_asc':
                            $query->orderBy('clicks_vin_request_form_count', 'asc');
                            break;
                        case 'clicks_explore_more_count_desc':
                            $query->orderBy('clicks_explore_more_count', 'desc');
                            break;
                        case 'clicks_explore_more_count_asc':
                            $query->orderBy('clicks_explore_more_count', 'asc');
                            break;
                        case 'vin_copy_count_desc':
                            $query->orderBy('vin_copy_count', 'desc');
                            break;
                        case 'vin_copy_count_asc':
                            $query->orderBy('vin_copy_count', 'asc');
                            break;
                        default:
                            $query->orderBy('request_timestamp', 'desc');
                            break;
                    }
                    $query->orderBy('clicks_visit_dealer_website_count', 'desc');
                } else {
                    // Default ordering
                    $query->orderBy('request_timestamp', 'desc');
                }

        if ($request->filled('from')) {
            $query->whereDate('request_timestamp', '>=', $request->from);
        }

        if ($request->filled('to')) {
            $query->whereDate('request_timestamp', '<=', $request->to);
        }
        

        // Filter based on dealersource in request JSON
       /* if ($request->filled('dealersource')) {
            $query->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(request, '$.dealersource')) = ?", [$request->dealersource]);
        }*/

        $dealerHost = $request->filled('dealersource')
        ? $request->dealersource
        : $chatbotSetting->dealership_url;

        // match either request.dealersource OR legacy request.dealersouce
        $query->where(function ($q) use ($dealerHost) {
        $q->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(request, '$.dealersource')) = ?", [$dealerHost])
        ->orWhereRaw("JSON_UNQUOTE(JSON_EXTRACT(request, '$.dealersouce')) = ?", [$dealerHost]);
        });
        // Paginate the results
     
       
       
        $conversations = $query->paginate(10)->appends([
            'from' => $request->get('from'),
            'to' => $request->get('to'),
            'order_by_clicks' => $request->get('order_by_clicks'),
        ]);
        // Format conversations and include follow-ups
        $formattedConversations = $conversations->map(function ($conversation) {
            // Decode the JSON in the 'request' and 'response' fields
            $validJsonString = $conversation->request;
            $validresponseJsonString = str_replace(["'", "None"], ['"', 'null'], $conversation->response);

            $request = json_decode($validJsonString, true);
            $response = json_decode($validresponseJsonString, true);
            $additionalInfoString = json_decode($conversation->additional_info,true);
            $additionalInfoJson = json_decode($additionalInfoString['response'], true);
            $user=[];
            if($conversation->user_id){
                $user = User::where('id',$conversation->user_id)->first()->toArray();
            }
            #dd($additionalInfoJson );
            // Extract values from response/additional_info
            $heading = $additionalInfoJson['heading'] ?? 'N/A';
            $subheading = $additionalInfoJson['subheading'] ?? 'N/A';
            $paragraphs = $additionalInfoJson['paragraphs'] ?? [];
            $listItems = $additionalInfoJson['list'] ?? [];

            $country = $request['country'] ?? 'N/A';
            $zipcode = $request['zip'] ?? 'N/A';
            $query = $request['request'] ?? 'N/A';
            $context = $request['context'] ?? 'N/A';
            $dealership_name = $request['dealership_name'] ?? 'N/A';
            $recordFound = $response['RecordFound'] ?? 'No';
            $apiurl = $response['apiurl'] ?? 'N/A';
            $followUps = $conversation->followUps->map(function ($followUp) {
                $validFollowUpRequestJson = $followUp->request;
                $validFollowUpResponseJson = str_replace(["'", "None"], ['"', 'null'], $followUp->response);
    
                $followUpRequest = json_decode($validFollowUpRequestJson, true);
                $followUpResponse = json_decode($validFollowUpResponseJson, true);
                $additionalInfoString = json_decode($followUp->additional_info,true);
                $additionalInfoJson = json_decode($additionalInfoString['response'], true);
                
                // Extract values from response/additional_info
                $heading = $additionalInfoJson['heading'] ?? 'N/A';
                $subheading = $additionalInfoJson['subheading'] ?? 'N/A';
                $paragraphs = $additionalInfoJson['paragraphs'] ?? [];
                $listItems = $additionalInfoJson['list'] ?? [];
                // Extract follow-up fields from JSON
                return [
                    'conversation_id' => $followUp->conversation_id,
                    'dealership_name' => $followUpRequest['dealership_name'] ?? 'N/A',
                    'query' => $followUpRequest['request'] ?? 'N/A',
                    'context' => $followUpRequest['context'] ?? 'N/A',
                    'country' => $followUpRequest['country'] ?? 'N/A',
                    'zipcode' => $followUpRequest['zip'] ?? 'N/A',
                    'recordFound' => $followUpResponse['RecordFound'] ?? 'No',
                    'apiurl' => $followUpResponse['apiurl'] ?? 'N/A',
                    'request_timestamp' => $followUp->request_timestamp,
                    'additional_info' => [
                        'heading' => $heading,
                        'subheading' => $subheading,
                        'paragraphs' => $paragraphs,
                        'listItems' => $listItems,
                    ],
                   
                ];
            });

            // Return the formatted conversation with follow-ups
            return [

                'conversation_id' => $conversation->conversation_id,
                'dealership_name' => $dealership_name,
                'query' => $query,
                'user_id'=>$conversation->user_id,
                'user'=>$user,
                'context' => $context,
                'country' => $country,
                'zipcode' => $zipcode,
                'recordFound' => $recordFound,
                'apiurl' => $apiurl,
                'request_timestamp' => $conversation->request_timestamp,
                'additional_info' => $conversation->additional_info,
                'additional_info' => [
                    'heading' => $heading,
                    'subheading' => $subheading,
                    'paragraphs' => $paragraphs,
                    'listItems' => $listItems,
                ],
                'session_timing' => $conversation->time_diff,
                'clicks_visit_dealer_website_count'=>$conversation->clicks_visit_dealer_website_count,
                'clicks_view_vehicle_count'=>$conversation->clicks_view_vehicle_count,
                'clicks_vin_request_form_count'=>$conversation->clicks_vin_request_form_count,
                'clicks_explore_more_count'=>$conversation->clicks_explore_more_count,
                'clicks_vin_copy_count'=>$conversation->vin_copy_count,
                'follow_ups' => $followUps, // Include follow-ups in the result
                'conversion_booking'=>$conversation->ConversionBooking->toArray(),
            ];
        });

        // Pass the formatted data to the view
        return view('template.dealers.conversation', [
            'conversations' => $formattedConversations,
            'from' => $request->from,
            'to' => $request->to,
            'pagination' => $conversations,
        ]);
    }

    

    public function exportAllConversations(Request $request)
    {
       
        //$chatbotSetting->dealership_url = 'billionauto.com';
        
                    $query = Conversation::with('followUps','ConversionBooking') ->withCount([
                        'clicksVisitDealerWebsite',
                        'clicksViewVehicle',
                        'clicksVinRequestForm',
                        'clicksExploreMore',
                        'vinCopy',
                        'followUps',
                        'ConversionBooking'
                    ]) 
                    ->where(function ($q) {
                        $q->whereNull('followup_id')->orWhere('followup_id', '');
                    });
                    if ($request->filled('order_by_clicks') && !empty($request['order_by_clicks'])) {
                        switch ($request['order_by_clicks']) {
                            case 'followup_lead_desc':
                                $query->orderBy('follow_ups_count', 'desc');
                                break;

                            case 'followup_lead_asc':
                                $query->orderBy('follow_ups_count', 'asc');
                                break;

                            case 'clicks_visit_dealer_website_count_desc':
                                $query->orderBy('clicks_visit_dealer_website_count', 'desc');
                                break;
                            
                            case 'clicks_visit_dealer_website_count_asc':
                                $query->orderBy('clicks_visit_dealer_website_count', 'asc');
                                break;
                            case 'clicks_view_vehicle_count_desc':
                                $query->orderBy('clicks_view_vehicle_count', 'desc');
                                break;
                            case 'clicks_view_vehicle_count_asc':
                                $query->orderBy('clicks_view_vehicle_count', 'asc');
                                break;
                            case 'clicks_vin_request_form_count_desc':
                                $query->orderBy('clicks_vin_request_form_count', 'desc');
                                break;
                            case 'clicks_vin_request_form_count_asc':
                                $query->orderBy('clicks_vin_request_form_count', 'asc');
                                break;
                            case 'clicks_explore_more_count_desc':
                                $query->orderBy('clicks_explore_more_count', 'desc');
                                break;
                            case 'clicks_explore_more_count_asc':
                                $query->orderBy('clicks_explore_more_count', 'asc');
                                break;
                            case 'vin_copy_count_desc':
                                $query->orderBy('vin_copy_count', 'desc');
                                break;
                            case 'vin_copy_count_asc':
                                $query->orderBy('vin_copy_count', 'asc');
                                break;
                            default:
                                $query->orderBy('request_timestamp', 'desc');
                                break;
                        }
                        $query->orderBy('clicks_visit_dealer_website_count', 'desc');
                    } else {
                        // Default ordering
                        $query->orderBy('request_timestamp', 'desc');
                    }

        if ($request->filled('from')) {
            $query->whereDate('request_timestamp', '>=', $request->from);
        }
        if ($request->filled('to')) {
            $query->whereDate('request_timestamp', '<=', $request->to);
        }
        if(isset($request['exportadmin'])){
            if ($request->filled('dealersource')) {
                $query->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(request, '$.dealersouce')) = ?", [$request->dealersource]);
            }else{
                $query->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(request, '$.dealership_name')) != ?", ['autopulse.ai']);
            }
        }else{
            $dealer = Auth::guard('dealer')->user();
            $chatbotSetting = ChatSetting::where('dealer_id', $dealer->id)->first();
            $query->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(request, '$.dealersouce')) = ?", [$chatbotSetting->dealership_url]);
        }


        
        $conversations = $query->get();

        // Prepare data for CSV export
        $csvData = [];
        foreach ($conversations as $conversation) {
            $request = json_decode($conversation->request, true);
            $response = json_decode(str_replace(["'", "None"], ['"', 'null'], $conversation->response), true);
            $additionalInfoString = json_decode($conversation->additional_info,true);
            $additionalInfoJson = json_decode($additionalInfoString['response'], true);
                
            $baseData = [
                'conversation_id' => $conversation->conversation_id,
                'dealership_name' => $request['dealership_name'] ?? 'N/A',
                'query' => $request['request'] ?? 'N/A',
                'context' => $request['context'] ?? 'N/A',
                'session_timing' => $conversation->time_diff,
                'request_timestamp' => $conversation->request_timestamp,
                'clicks_visit_dealer_website_count'=>$conversation->clicks_visit_dealer_website_count,
                'clicks_view_vehicle_count'=>$conversation->clicks_view_vehicle_count,
                'clicks_vin_request_form_count'=>$conversation->clicks_vin_request_form_count,
                'clicks_explore_more_count'=>$conversation->clicks_explore_more_count,
                'conversion_booking'=>$conversation->booking,
                'response' => json_encode($additionalInfoJson),
               'user_name'=>isset($conversation->ConversionBooking[0])? ($conversation->ConversionBooking[0]['name']):'',
                    'user_email'=>isset($conversation->ConversionBooking[0])? ($conversation->ConversionBooking[0]['email']):'',
                    'user_phone'=>isset($conversation->ConversionBooking[0])? ($conversation->ConversionBooking[0]['phone']):'',
                    'booking_date'=>isset($conversation->ConversionBooking[0])? ($conversation->ConversionBooking[0]['booking_date']):'',
                    'booking_time'=>isset($conversation->ConversionBooking[0])? ($conversation->ConversionBooking[0]['booking_time']):'',
            ];

            // Add the base conversation data
            $csvData[] = $baseData;

            // Add follow-up data
            foreach ($conversation->followUps as $followUp) {
                $followUpRequest = json_decode($followUp->request, true);
                $additionalInfoString = json_decode($followUp->additional_info,true);
                $additionalInfoJson = json_decode($additionalInfoString['response'], true);
                
                $followUpData = [
                    'conversation_id' => $followUp->conversation_id,
                    'dealership_name' => $followUpRequest['dealership_name'] ?? 'N/A',
                    'query' => $followUpRequest['request'] ?? 'N/A',
                    'context' => $followUpRequest['context'] ?? 'N/A',
                    'clicks_visit_dealer_website_count'=>$conversation->clicks_visit_dealer_website_count,
                    'clicks_view_vehicle_count'=>$conversation->clicks_view_vehicle_count,
                    'clicks_vin_request_form_count'=>$conversation->clicks_vin_request_form_count,
                    'clicks_explore_more_count'=>$conversation->clicks_explore_more_count,
                    'session_timing' => $conversation->time_diff,
                    'request_timestamp' => $followUp->request_timestamp,
                    'response' => json_encode($additionalInfoJson),
                    'user_name'=>isset($conversation->ConversionBooking[0])? ($conversation->ConversionBooking[0]['name']):'',
                    'user_email'=>isset($conversation->ConversionBooking[0])? ($conversation->ConversionBooking[0]['email']):'',
                    'user_phone'=>isset($conversation->ConversionBooking[0])? ($conversation->ConversionBooking[0]['phone']):'',
                    'booking_date'=>isset($conversation->ConversionBooking[0])? ($conversation->ConversionBooking[0]['booking_date']):'',
                    'booking_time'=>isset($conversation->ConversionBooking[0])? ($conversation->ConversionBooking[0]['booking_time']):'',
                   
                ];
                
                $csvData[] = $followUpData;
            }
        }

        // Generate CSV
        $filename = "all_conversations_" . date('Y-m-d') . ".csv";
        $headers = ['Content-Type' => 'text/csv', 'Content-Disposition' => "attachment; filename=\"$filename\""];
        
        $callback = function() use ($csvData) {
            $handle = fopen('php://output', 'w');
            fputcsv($handle, array_keys($csvData[0])); // CSV Header
            foreach ($csvData as $row) {
                fputcsv($handle, $row);
            }
            fclose($handle);
        };

        return response()->stream($callback, 200, $headers);
    }

    /**
     * Display a specific conversation for dealer
     */
    public function dealerConversationDetail(Request $request, $conversationId)
    {
        $dealer = Auth::guard('dealer')->user();
        $chatbotSetting = ChatSetting::where('dealer_id', $dealer->id)->first();
        
        if (!$chatbotSetting) {
            abort(404, 'Chat settings not found');
        }

        // Get the specific conversation with all related data
        $conversation = Conversation::with('followUps', 'ConversionBooking')
            ->withCount([
                'clicksVisitDealerWebsite',
                'clicksViewVehicle',
                'clicksVinRequestForm',
                'clicksExploreMore',
                'vinCopy',
                'followUps',
                'ConversionBooking'
            ])
            ->where('conversation_id', $conversationId)
            ->where(function ($q) {
                $q->whereNull('followup_id')
                ->orWhere('followup_id', ''); // Check for empty string
            })
            ->first();

        if (!$conversation) {
            abort(404, 'Conversation not found');
        }

        // Verify this conversation belongs to the dealer's chatbot
        $dealerHost = $chatbotSetting->dealership_url;
        $requestData = json_decode($conversation->request, true);
        $conversationDealerSource = $requestData['dealersource'] ?? $requestData['dealersouce'] ?? '';
        $conversationBelongsToDealer = ($conversationDealerSource === $dealerHost);

        if (!$conversationBelongsToDealer) {
            abort(403, 'You do not have permission to view this conversation');
        }

        // Format the conversation data (reuse the same logic from dealerConversion)
        $validJsonString = $conversation->request;
        $validresponseJsonString = str_replace(["'", "None"], ['"', 'null'], $conversation->response);

        $request = json_decode($validJsonString, true);
        $response = json_decode($validresponseJsonString, true);
        $additionalInfoString = json_decode($conversation->additional_info, true);
        $additionalInfoJson = json_decode($additionalInfoString['response'], true);
        
        $user = [];
        if ($conversation->user_id) {
            $user = User::where('id', $conversation->user_id)->first()->toArray();
        }

        // Extract values from response/additional_info
        $heading = $additionalInfoJson['heading'] ?? 'N/A';
        $subheading = $additionalInfoJson['subheading'] ?? 'N/A';
        $paragraphs = $additionalInfoJson['paragraphs'] ?? [];
        $listItems = $additionalInfoJson['list'] ?? [];

        $country = $request['country'] ?? 'N/A';
        $zipcode = $request['zip'] ?? 'N/A';
        $query = $request['request'] ?? 'N/A';
        $context = $request['context'] ?? 'N/A';
        $dealership_name = $request['dealership_name'] ?? 'N/A';
        $recordFound = $response['RecordFound'] ?? 'No';
        $apiurl = $response['apiurl'] ?? 'N/A';

        // Format follow-ups
        $followUps = $conversation->followUps->map(function ($followUp) {
            $validFollowUpRequestJson = $followUp->request;
            $validFollowUpResponseJson = str_replace(["'", "None"], ['"', 'null'], $followUp->response);

            $followUpRequest = json_decode($validFollowUpRequestJson, true);
            $followUpResponse = json_decode($validFollowUpResponseJson, true);
            $additionalInfoString = json_decode($followUp->additional_info, true);
            $additionalInfoJson = json_decode($additionalInfoString['response'], true);
            
            // Extract values from response/additional_info
            $heading = $additionalInfoJson['heading'] ?? 'N/A';
            $subheading = $additionalInfoJson['subheading'] ?? 'N/A';
            $paragraphs = $additionalInfoJson['paragraphs'] ?? [];
            $listItems = $additionalInfoJson['list'] ?? [];
            
            // Extract follow-up fields from JSON
            return [
                'conversation_id' => $followUp->conversation_id,
                'dealership_name' => $followUpRequest['dealership_name'] ?? 'N/A',
                'query' => $followUpRequest['request'] ?? 'N/A',
                'context' => $followUpRequest['context'] ?? 'N/A',
                'country' => $followUpRequest['country'] ?? 'N/A',
                'zipcode' => $followUpRequest['zip'] ?? 'N/A',
                'recordFound' => $followUpResponse['RecordFound'] ?? 'No',
                'apiurl' => $followUpResponse['apiurl'] ?? 'N/A',
                'request_timestamp' => $followUp->request_timestamp,
                'additional_info' => [
                    'heading' => $heading,
                    'subheading' => $subheading,
                    'paragraphs' => $paragraphs,
                    'listItems' => $listItems,
                ],
            ];
        });

        // Format the main conversation data
        $formattedConversation = [
            'conversation_id' => $conversation->conversation_id,
            'dealership_name' => $dealership_name,
            'query' => $query,
            'user_id' => $conversation->user_id,
            'user' => $user,
            'context' => $context,
            'country' => $country,
            'zipcode' => $zipcode,
            'recordFound' => $recordFound,
            'apiurl' => $apiurl,
            'request_timestamp' => $conversation->request_timestamp,
            'additional_info' => [
                'heading' => $heading,
                'subheading' => $subheading,
                'paragraphs' => $paragraphs,
                'listItems' => $listItems,
            ],
            'session_timing' => $conversation->time_diff,
            'clicks_visit_dealer_website_count' => $conversation->clicks_visit_dealer_website_count,
            'clicks_view_vehicle_count' => $conversation->clicks_view_vehicle_count,
            'clicks_vin_request_form_count' => $conversation->clicks_vin_request_form_count,
            'clicks_explore_more_count' => $conversation->clicks_explore_more_count,
            'clicks_vin_copy_count' => $conversation->vin_copy_count,
            'follow_ups' => $followUps,
            'conversion_booking' => $conversation->ConversionBooking->toArray(),
        ];

        // Pass the formatted data to the view
        return view('template.dealers.conversation-detail', [
            'conversation' => $formattedConversation,
            'chatbotSetting' => $chatbotSetting,
        ]);
    }

}

