<?php
namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Queue\SerializesModels;
use Illuminate\Contracts\Queue\ShouldQueue;

class SubscriptionConfirmation extends Mailable
{
    use Queueable, SerializesModels;

    public $user;
    public $subscription;
    public $store;
    public $transactions;

    /**
     * Create a new message instance.
     *
     * @return void
     */
    public function __construct($user, $subscription,$store,$transactions)
    {
        $this->user = $user;
        $this->subscription = $subscription;
        $this->store= $store;
        $this->transactions= $transactions;
    }

    /**
     * Build the message.
     *
     * @return $this
     */
    public function build()
    {
        return $this->view('emails.subscription-confirmation')
                    ->subject('Subscription Confirmation')
                    ->with([
                        'userName' => $this->user->name,
                        'planName' => $this->subscription->plan->nickname,
                        'currentPeriodEnd' => \Carbon\Carbon::createFromTimestamp($this->subscription->current_period_end)->toFormattedDateString(),
                        'transaction' =>  $this->transactions,
                    ]);
    }
}
