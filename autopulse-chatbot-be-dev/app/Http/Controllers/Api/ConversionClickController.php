<?php
namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Support\Facades\App;
use Illuminate\Http\Request;
use App\Models\ConversionClick;
use App\Models\Conversation;
class ConversionClickController extends Controller
{
    public function sessionTime(Request $request)
    {
        $params = $request->all();
     
        // Retrieve the conversation using the model and check for follow-up conditions
        $conversion = Conversation::where('conversation_id', $request->conversion_id)
            ->where(function ($query) {
                $query->whereNull('followup_id')
                      ->orWhere('followup_id', '');
            })
            ->first();
        #dd($conversion);
        // Check if the conversation exists and update it
        if ($conversion) {
            // Set chat close time to the current timestamp
            $conversion->chat_close_time = now();
    
            // Calculate the time difference in seconds
            $conversion->time_diff = strtotime($conversion->chat_close_time) - strtotime($conversion->request_timestamp);
    
            // Save the updated conversation data
            $conversion->save();
    
            return response()->json([
                'message' => 'Record updated successfully',
                'data' => $conversion,
            ], 200);
        }
    
        // Return a response if the conversation was not found
        return response()->json([
            'message' => 'Conversation not found',
        ], 404);
    }
    

    public function click(Request $request)
    {
        $params = $request->all();

        // Convert empty array vin to null
        $vin = $params['vin'] ?? null;
        if (is_array($vin) && empty($vin)) {
            $vin = null;
        }

        // Insert the data into the secondary database using the model
        $botClickAction = ConversionClick::create([
            'conversion_id' => $params['conversion_id'],
            'action' => $params['action'],
            'otherdetail' => $params['otherdetail'] ?? null,
            'vin' => $vin,
            'source' => $params['source'] ?? null,
        ]);

        return response()->json([
            'message' => 'Record created successfully',
            'data' => $botClickAction,
        ], 201);
    }
}
