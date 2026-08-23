<?php
namespace App\Jobs;

use App\Models\User;
use App\Models\Vehicle;
use App\Models\Dealer;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Mail;
use App\Mail\LeadNotificationMail;
use App\Mail\Adfmail;

class SendLeadNotification implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    protected $user;
    protected $vehicle;
    protected $dealer;
    protected $booking;

    /**
     * Create a new job instance.
     *
     * @return void
     */
    public function __construct( $user = NULL, $vehicle = null, $dealer, $booking = null )
    {
        $this->user = $user;
        $this->vehicle = $vehicle;
        $this->dealer = $dealer;
        $this->booking = $booking;
    }

    /**
     * Execute the job.
     *
     * @return void
     */
    public function handle()
    {
        //Mail::to($this->dealer['email'])->send(new LeadNotificationMail($this->user, $this->vehicle, $this->dealer));
        
        // Check if adf_mail exists and is not empty
        if(isset($this->dealer['adf_mail']) && !empty($this->dealer['adf_mail'])) {
            // Split comma-separated emails and trim whitespace
            $emails = array_map('trim', explode(',', $this->dealer['adf_mail']));
            
            // Filter out empty emails and validate email format
            $validEmails = array_filter($emails, function($email) {
                return !empty($email) && filter_var($email, FILTER_VALIDATE_EMAIL);
            });
            
            // Send email to each valid email address
            foreach ($validEmails as $email) {
                try {
                    Mail::to($email)->send(new Adfmail($this->user, $this->vehicle, $this->dealer, $this->booking));
                } catch (\Exception $e) {
                    // Log error but continue with other emails
                    \Log::error('Failed to send lead notification email', [
                        'email' => $email,
                        'dealer_id' => $this->dealer['id'] ?? 'unknown',
                        'error' => $e->getMessage()
                    ]);
                }
            }
        }

        //Mail::to($this->dealer['email'])->send(new LeadNotificationMail($this->user, $this->vehicle, $this->dealer));
    }
}
