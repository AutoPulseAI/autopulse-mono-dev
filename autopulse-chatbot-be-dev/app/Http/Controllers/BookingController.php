<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Models\Booking;
use App\Models\ConversionBooking;
use App\Models\Dealer;
use App\Models\User;
use App\Models\Conversation;
use App\Models\FacebookBookingTracking;

class BookingController extends Controller
{
    /**
     * Show the booking form with prefilled data
     */
    public function showBookingForm(Request $request)
    {
        // Get parameters from URL
        $dealerId = $request->get('dealer_id');
        $utmSource = $request->get('utm_source');
        $userId = $request->get('user_id');
        $vehicleId = $request->get('vehicle_id');
        $vehicleTitle = $request->get('vehicle_title');
        $conversationId = $request->get('conversation_id');

        // Validate required parameters
        if (!$dealerId || !$utmSource || !$userId) {
            return redirect('/')->with('error', 'Invalid booking parameters');
        }

        // Get dealer information
        $dealer = Dealer::find($dealerId);
        if (!$dealer) {
            return redirect('/')->with('error', 'Dealer not found');
        }

        // Get user information
        $user = User::find($userId);
        if (!$user) {
            return redirect('/')->with('error', 'User not found');
        }

        // Get conversation if exists
        $conversation = Conversation::where('user_id', $userId)
            ->where('chat_source', 'facebook')
            ->latest()
            ->first();

        // Prefill data using existing model fields
        $prefilledData = [
            'dealer_id' => $dealerId,
            'utm_source' => $utmSource,
            'user_id' => $userId,
            'vehicle_id' => $vehicleId,
            'vehicle_title' => urldecode($vehicleTitle),
            'name' => $user->name ?? '', // Using existing 'name' field
            'dealer_name' => $dealer->name ?? '',
            'conversation_id' => $conversationId ?? ($conversation ? $conversation->conversation_id : null)
        ];

        // Save initial tracking data
        $trackingRecord = $this->saveInitialTracking($prefilledData);

        return view('booking.visit-form', compact('prefilledData', 'dealer', 'user', 'trackingRecord'));
    }

    /**
     * Process the booking form submission
     */
    public function processBooking(Request $request)
    {
        $request->validate([
            'dealer_id' => 'required|exists:dealers,id',
            'user_id' => 'required|exists:users,id',
            'name' => 'required|string|max:255', // Using existing 'name' field
            'email' => 'required|email', // Using existing 'email' field
            'phone' => 'required|string|max:20', // Using existing 'phone' field
            'booking_date' => 'required|date|after:today', // Using existing 'booking_date' field
            'booking_time' => 'required|string', // Using existing 'booking_time' field
            'utm_source' => 'required|string',
            'vehicle_id' => 'nullable',
            'vehicle_title' => 'nullable|string',
            'tracking_id' => 'nullable|exists:facebook_booking_tracking,id'
        ]);

        try {
            DB::beginTransaction();

            // Create the booking using existing model fields
            $booking = Booking::create([
                'dealer_id' => $request->dealer_id,
                'user_id' => $request->user_id,
                'name' => $request->name, // Existing field
                'email' => $request->email, // Existing field
                'phone' => $request->phone, // Existing field
                'booking_date' => $request->booking_date, // Existing field
                'booking_time' => $request->booking_time, // Existing field
                'conversion_id' => $request->conversation_id // Using existing 'conversion_id' field
            ]);

            // Create conversion booking record
            if ($request->conversation_id) {
                ConversionBooking::create([
                    'conversion_id' => $request->conversation_id,
                    'booking_id' => $booking->id,
                    'dealer_id' => $request->dealer_id,
                    'user_id' => $request->user_id,
                    'utm_source' => $request->utm_source,
                    'source_type' => 'facebook_messenger'
                ]);
            }

            // Update tracking record to mark as converted
            if ($request->tracking_id) {
                $trackingRecord = FacebookBookingTracking::find($request->tracking_id);
                if ($trackingRecord) {
                    $trackingRecord->markConverted($booking->id);
                }
            }

            // Update user information if provided
            $user = User::find($request->user_id);
            if ($user) {
                $user->update([
                    'name' => $request->name,
                    'email' => $request->email,
                    'phone' => $request->phone
                ]);
            }

            DB::commit();

            // Log successful booking
            Log::info('Facebook Messenger booking created successfully', [
                'booking_id' => $booking->id,
                'dealer_id' => $request->dealer_id,
                'user_id' => $request->user_id,
                'utm_source' => $request->utm_source,
                'tracking_id' => $request->tracking_id
            ]);

            return redirect()->route('booking.success', ['id' => $booking->id])
                ->with('success', 'Your visit has been booked successfully!');

        } catch (\Exception $e) {
            DB::rollBack();
            Log::error('Failed to create Facebook Messenger booking', [
                'error' => $e->getMessage(),
                'request_data' => $request->all()
            ]);

            return back()->with('error', 'Failed to book your visit. Please try again.')
                ->withInput();
        }
    }

    /**
     * Show booking success page
     */
    public function showSuccess(Request $request, $id)
    {
        $booking = Booking::with(['dealer', 'user'])->findOrFail($id);
        return view('booking.success', compact('booking'));
    }

    /**
     * Save initial tracking data when user visits the booking form
     */
    private function saveInitialTracking($data)
    {
        try {
            // Create a tracking record
            $trackingRecord = FacebookBookingTracking::create([
                'dealer_id' => $data['dealer_id'],
                'user_id' => $data['user_id'],
                'conversation_id' => $data['conversation_id'],
                'vehicle_id' => $data['vehicle_id'],
                'vehicle_title' => $data['vehicle_title'],
                'utm_source' => $data['utm_source'],
                'source_type' => 'facebook_messenger',
                'session_id' => FacebookBookingTracking::generateSessionId(),
                'visited_at' => now(),
                'status' => 'visited',
                'additional_data' => [
                    'user_agent' => request()->userAgent(),
                    'ip_address' => request()->ip(),
                    'referrer' => request()->header('referer'),
                    'landing_page' => request()->fullUrl()
                ]
            ]);

            Log::info('Facebook Messenger booking tracking record created', [
                'tracking_id' => $trackingRecord->id,
                'dealer_id' => $data['dealer_id'],
                'user_id' => $data['user_id']
            ]);

            return $trackingRecord;

        } catch (\Exception $e) {
            Log::error('Failed to save tracking data', [
                'error' => $e->getMessage(),
                'data' => $data
            ]);
            return null;
        }
    }

    /**
     * Get tracking analytics for a dealer
     */
    public function getTrackingAnalytics(Request $request, $dealerId)
    {
        $startDate = $request->get('start_date');
        $endDate = $request->get('end_date');

        $analytics = FacebookBookingTracking::getDealerAnalytics($dealerId, $startDate, $endDate);

        return response()->json([
            'success' => true,
            'analytics' => $analytics
        ]);
    }

    /**
     * Export tracking data for a specific booking
     */
    public function exportTrackingData($id)
    {
        $booking = Booking::with(['dealer', 'user'])->findOrFail($id);
        
        // Find tracking record
        $tracking = FacebookBookingTracking::where('booking_id', $id)->first();
        
        if (!$tracking) {
            return redirect()->back()->with('error', 'No tracking data found for this booking');
        }

        $filename = "tracking_data_booking_{$id}_" . date('Y-m-d_H-i-s') . ".csv";
        
        $headers = [
            'Content-Type' => 'text/csv',
            'Content-Disposition' => "attachment; filename=\"$filename\"",
        ];

        $callback = function() use ($tracking, $booking) {
            $file = fopen('php://output', 'w');
            
            // CSV Headers
            fputcsv($file, [
                'Tracking ID', 'Dealer ID', 'User ID', 'Conversation ID', 'Vehicle ID',
                'Vehicle Title', 'UTM Source', 'Source Type', 'Page ID', 'Sender ID',
                'Session ID', 'Visit Date', 'Converted Date', 'Status', 'Additional Data',
                'Customer Name', 'Customer Email', 'Customer Phone', 'Booking Date', 'Booking Time'
            ]);
            
            // CSV Data
            fputcsv($file, [
                $tracking->id,
                $tracking->dealer_id,
                $tracking->user_id,
                $tracking->conversation_id,
                $tracking->vehicle_id,
                $tracking->vehicle_title,
                $tracking->utm_source,
                $tracking->source_type,
                $tracking->page_id,
                $tracking->sender_id,
                $tracking->session_id,
                $tracking->visited_at,
                $tracking->converted_at,
                $tracking->status,
                json_encode($tracking->additional_data),
                $booking->name,
                $booking->email,
                $booking->phone,
                $booking->booking_date,
                $booking->booking_time
            ]);
            
            fclose($file);
        };

        return response()->stream($callback, 200, $headers);
    }
}
