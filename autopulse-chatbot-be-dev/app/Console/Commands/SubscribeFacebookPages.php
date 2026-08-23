<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Models\FacebookPage;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class SubscribeFacebookPages extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'facebook:subscribe-pages {--dealer-id= : Subscribe pages for specific dealer}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Subscribe all Facebook pages to webhook events';

    /**
     * Execute the console command.
     */
    public function handle()
    {
        $dealerId = $this->option('dealer-id');
        
        $query = FacebookPage::where('is_active', true);
        if ($dealerId) {
            $query->where('dealer_id', $dealerId);
        }
        
        $pages = $query->get();
        
        if ($pages->isEmpty()) {
            $this->info('No active Facebook pages found.');
            return;
        }
        
        $this->info("Found {$pages->count()} active Facebook page(s).");
        
        $successCount = 0;
        $errorCount = 0;
        
        foreach ($pages as $page) {
            $this->info("Processing page: {$page->page_name} (ID: {$page->page_id})");
            
            try {
                $response = Http::asForm()->post(
                    "https://graph.facebook.com/v23.0/{$page->page_id}/subscribed_apps",
                    [
                        'access_token' => $page->access_token,
                        'subscribed_fields' => ['messages', 'messaging_postbacks'],
                    ]
                );
                
                if ($response->successful()) {
                    $this->info("✅ Successfully subscribed {$page->page_name}");
                    $successCount++;
                    
                    Log::info('Command: Successfully subscribed page to webhook events', [
                        'page_id' => $page->page_id,
                        'page_name' => $page->page_name,
                        'dealer_id' => $page->dealer_id
                    ]);
                } else {
                    $this->error("❌ Failed to subscribe {$page->page_name}: " . $response->body());
                    $errorCount++;
                    
                    Log::error('Command: Failed to subscribe page to webhook events', [
                        'page_id' => $page->page_id,
                        'page_name' => $page->page_name,
                        'dealer_id' => $page->dealer_id,
                        'error' => $response->json()
                    ]);
                }
            } catch (\Exception $e) {
                $this->error("❌ Exception for {$page->page_name}: " . $e->getMessage());
                $errorCount++;
                
                Log::error('Command: Exception subscribing page to webhook', [
                    'page_id' => $page->page_id,
                    'page_name' => $page->page_name,
                    'dealer_id' => $page->dealer_id,
                    'error' => $e->getMessage()
                ]);
            }
            
            // Add a small delay to avoid rate limiting
            sleep(1);
        }
        
        $this->newLine();
        $this->info("Summary:");
        $this->info("✅ Successfully subscribed: {$successCount}");
        $this->info("❌ Failed: {$errorCount}");
        
        if ($errorCount > 0) {
            $this->warn("Some pages failed to subscribe. Check the logs for details.");
        }
    }
}
