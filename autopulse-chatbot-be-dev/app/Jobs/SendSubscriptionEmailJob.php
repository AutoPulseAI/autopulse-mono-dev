<?php
namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use App\Mail\SubscriptionDetailsMail;
use Stripe\Invoice;
use Stripe\Stripe;
use Illuminate\Foundation\Bus\Dispatchable;

class SendSubscriptionEmailJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    protected $subscriptionDetails;
    protected $dealer;
    protected $invoiceId;

    public function __construct($subscriptionDetails, $dealer, $invoiceId)
    {
        $this->subscriptionDetails = $subscriptionDetails;
        $this->dealer = $dealer;
        $this->invoiceId = $invoiceId;
    }

    public function handle()
    {
        // Set the Stripe API key
        Stripe::setApiKey(env('STRIPE_SECRET'));

        // Log the invoice ID for debugging
        Log::info('Retrieving Stripe invoice', ['invoice_id' => $this->invoiceId]);

        try {
            // Retrieve the invoice from Stripe
            $invoice = Invoice::retrieve($this->invoiceId);

            // Send the email
            Mail::to($this->dealer->email)->send(new SubscriptionDetailsMail($this->subscriptionDetails, $this->dealer, $invoice));
        } catch (\Exception $e) {
            // Log any errors that occur during the process
            Log::error('Error retrieving Stripe invoice or sending email', ['error' => $e->getMessage()]);
        }
    }
}
