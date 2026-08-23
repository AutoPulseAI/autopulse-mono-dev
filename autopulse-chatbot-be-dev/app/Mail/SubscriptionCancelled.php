<?php
namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Queue\SerializesModels;
use Illuminate\Contracts\Queue\ShouldQueue;
use App\Models\DealerSource;

class SubscriptionCancelled extends Mailable
{
    use Queueable, SerializesModels;

    public $store;

    /**
     * Create a new message instance.
     *
     * @param DealerSource $store
     * @return void
     */
    public function __construct(DealerSource $store)
    {
        $this->store = $store;
    }

    /**
     * Build the message.
     *
     * @return $this
     */
    public function build()
    {
        return $this->subject('Subscription Cancelled')
                    ->view('emails.subscription_cancelled')
                    ->with([
                        'storeName' => $this->store->dealership_name,
                        'cancelledAt' => now()->format('Y-m-d H:i:s'),
                    ]);
    }
}
