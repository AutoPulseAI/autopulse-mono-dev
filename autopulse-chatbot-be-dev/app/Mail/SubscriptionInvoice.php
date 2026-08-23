<?php
namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Queue\SerializesModels;

class SubscriptionInvoice extends Mailable
{
    use Queueable, SerializesModels;

    public $dealer;
    public $pdfPath;
    public $totalAmount;
    public $discountAmount;
    public $finalAmount;
    public $purchasedStores;

    public function __construct($dealer, $totalAmount, $discountAmount, $finalAmount, $purchasedStores, $pdfPath)
    {
        $this->dealer = $dealer;
        $this->totalAmount = $totalAmount;
        $this->discountAmount = $discountAmount;
        $this->finalAmount = $finalAmount;
        $this->pdfPath = $pdfPath;
        $this->purchasedStores = $purchasedStores;
    }

    public function build()
    {
        return $this->view('emails.subscription_invoice')
                    ->subject('Your Subscription Invoice')
                    ->with([
                        'dealer' => $this->dealer,
                        'totalAmount' => $this->totalAmount,
                        'discountAmount' => $this->discountAmount,
                        'finalAmount' => $this->finalAmount,
                        'purchasedStores' => $this->purchasedStores,
                    ])
                    ->attach($this->pdfPath, [
                        'as' => 'invoice.pdf',
                        'mime' => 'application/pdf',
                    ]);
    }
}
