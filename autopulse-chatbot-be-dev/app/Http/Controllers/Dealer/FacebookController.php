<?php

namespace App\Http\Controllers\Dealer;

use Illuminate\Http\Request;
use App\Models\FacebookPage;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Auth;
use Laravel\Socialite\Facades\Socialite;
use Illuminate\Support\Facades\Http;
use App\Http\Controllers\Controller;

class FacebookController extends Controller
{
   

    // Show the Facebook integration page
    public function index()
    {
        $facebookPage = FacebookPage::where('dealer_id', Auth::guard('dealer')->id())->first();
        return view('template.dealers.messanger', compact('facebookPage'));
    }

    // Redirect to Facebook for authentication
    public function redirectToFacebook()
    {
        $scopes = ['pages_manage_metadata', 'pages_messaging', 'pages_read_engagement'];
        $redirectUri = url('/facebook/callback');
        
        return Socialite::driver('facebook')
            ->scopes($scopes)
            ->redirectUrl($redirectUri)
            ->redirect();
    }

    // Handle Facebook callback
    public function handleFacebookCallback()
    {
        try {
            $user = Socialite::driver('facebook')->user();
            $token = $user->token;
            
            // Get pages the user manages
            $response = Http::get("https://graph.facebook.com/v12.0/me/accounts", [
                'access_token' => $token
            ]);
            
            if (!$response->successful()) {
                throw new \Exception('Failed to fetch Facebook pages');
            }
            
            $pages = $response->json()['data'];
            
            // Store the first page (you might want to let user select which page to connect)
            if (count($pages) > 0) {
                $page = $pages[0];
                $dealer = Auth::guard('dealer')->user();
                $facebookPage = FacebookPage::updateOrCreate(
                    ['dealer_id' => Auth::guard('dealer')->id()],
                    [
                        'page_id' => $page['id'],
                       
                        'access_token' => $page['access_token'],
                        'page_name' => $page['name'],
                        'verify_token' => Str::random(32),
                        'is_active' => true
                    ]
                );
                
                // Subscribe this page to webhook events
                $this->subscribePageToWebhook($facebookPage);
                
                return redirect()->route('dealer.facebook')->with('success', 'Facebook Page connected successfully!');
            }
            
            return redirect()->route('dealer.facebook')->with('error', 'No Facebook pages found for this account');
            
        } catch (\Exception $e) {
            return redirect()->route('dealer.facebook')->with('error', 'Failed to connect: ' . $e->getMessage());
        }
    }

    /**
     * Subscribe a Facebook page to webhook events
     */
    protected function subscribePageToWebhook(FacebookPage $page)
    {
        try {
            // Subscribe the page to your app
            $response = Http::asForm()->post(
                "https://graph.facebook.com/v23.0/{$page->page_id}/subscribed_apps",
                [
                    'access_token' => $page->access_token,
                    'subscribed_fields' => ['messages', 'messaging_postbacks'],
                ]
            );

            if ($response->successful()) {
                \Log::info('Successfully subscribed page to webhook events', [
                    'page_id' => $page->page_id,
                    'page_name' => $page->page_name,
                    'dealer_id' => $page->dealer_id
                ]);
            } else {
                \Log::error('Failed to subscribe page to webhook events', [
                    'page_id' => $page->page_id,
                    'error' => $response->json()
                ]);
            }
        } catch (\Exception $e) {
            \Log::error('Exception subscribing page to webhook', [
                'page_id' => $page->page_id,
                'error' => $e->getMessage()
            ]);
        }
    }
    
    // Disconnect Facebook page
    public function disconnect(Request $request)
    {
        $page = FacebookPage::where('dealer_id', Auth::guard('dealer')->id())->first();
        
        if ($page) {
            $page->delete();
            return redirect()->route('dealer.facebook')->with('success', 'Facebook Page disconnected successfully');
        }
        
        return redirect()->route('dealer.facebook')->with('error', 'No connected page found');
    }
    
    // Test webhook connection
   /**
 * Test Facebook webhook connection
 * 
 * @route /api/webhook/facebook/test
 * @method POST
 */
/**
 * Test Facebook webhook connection
 * 
 * @route /api/webhook/facebook/test
 * @method POST
 */
public function testWebhook(Request $request)
{
    // Get authenticated dealer
    $dealer = Auth::guard('dealer')->user();
    if (!$dealer) {
        return response()->json([
            'success' => false,
            'message' => 'Unauthorized'
        ], 401);
    }

    // Get connected Facebook page
    $page = FacebookPage::where('dealer_id', $dealer->id)->first();
    if (!$page) {
        return response()->json([
            'success' => false,
            'message' => 'No Facebook page connected for this dealer'
        ], 404);
    }

    try {
        // First verify the page access token is still valid
        $tokenResponse = Http::get("https://graph.facebook.com/v23.0/debug_token", [
            'input_token' => $page->access_token,
            'access_token' => config('services.facebook.client_id').'|'.config('services.facebook.client_secret')
        ]);

        if (!$tokenResponse->successful()) {
            throw new \Exception('Invalid access token');
        }

        $tokenData = $tokenResponse->json();
        if ($tokenData['data']['is_valid'] === false) {
            $page->update(['is_active' => false]);
            return response()->json([
                'success' => false,
                'message' => 'Access token is invalid or expired',
                'error' => $tokenData['data']['error'] ?? null
            ], 401);
        }

        // Alternative test: Get page details instead of sending message
        $testResponse = Http::get("https://graph.facebook.com/v23.0/{$page->page_id}", [
            'fields' => 'name,id',
            'access_token' => $page->access_token
        ]);

        if ($testResponse->successful()) {
            $page->update(['is_active' => true]);
            return response()->json([
                'success' => true,
                'message' => 'Webhook connection verified successfully',
                'page_data' => $testResponse->json()
            ]);
        }

        // Handle Facebook API error
        $error = $testResponse->json()['error'] ?? ['message' => 'Unknown error'];
        return response()->json([
            'success' => false,
            'message' => 'Facebook API error: ' . $error['message'],
            'error_code' => $error['code'] ?? null,
            'error_subcode' => $error['error_subcode'] ?? null,
            'fbtrace_id' => $error['fbtrace_id'] ?? null
        ], 400);

    } catch (\Exception $e) {
        \Log::error('Facebook webhook test failed', [
            'dealer_id' => $dealer->id,
            'error' => $e->getMessage(),
            'trace' => $e->getTraceAsString()
        ]);

        return response()->json([
            'success' => false,
            'message' => 'Test failed: ' . $e->getMessage()
        ], 500);
    }
}

    /**
     * Manually subscribe existing pages to webhook events
     */
    public function subscribeExistingPages()
    {
        try {
            $dealer = Auth::guard('dealer')->user();
            $pages = FacebookPage::where('dealer_id', $dealer->id)->get();
            
            $results = [];
            foreach ($pages as $page) {
                if ($page->is_active) {
                    $this->subscribePageToWebhook($page);
                    $results[] = [
                        'page_name' => $page->page_name,
                        'page_id' => $page->page_id,
                        'status' => 'subscribed'
                    ];
                }
            }
            
            return response()->json([
                'success' => true,
                'message' => 'Pages subscribed to webhook events',
                'results' => $results
            ]);
            
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to subscribe pages: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Check webhook subscription status for all pages
     */
    public function checkWebhookStatus()
    {
        try {
            $dealer = Auth::guard('dealer')->user();
            $pages = FacebookPage::where('dealer_id', $dealer->id)->get();
            
            $statuses = [];
            foreach ($pages as $page) {
                $response = Http::get("https://graph.facebook.com/v23.0/{$page->page_id}/subscribed_apps", [
                    'access_token' => $page->access_token
                ]);
                
                $isSubscribed = false;
                if ($response->successful()) {
                    $data = $response->json();
                    $isSubscribed = !empty($data['data']);
                }
                
                $statuses[] = [
                    'page_name' => $page->page_name,
                    'page_id' => $page->page_id,
                    'is_subscribed' => $isSubscribed,
                    'is_active' => $page->is_active
                ];
            }
            
            return response()->json([
                'success' => true,
                'statuses' => $statuses
            ]);
            
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to check status: ' . $e->getMessage()
            ], 500);
        }
    }
}