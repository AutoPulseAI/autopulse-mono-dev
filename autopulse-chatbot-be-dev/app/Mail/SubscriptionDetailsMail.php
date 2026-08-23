<?php
namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Queue\SerializesModels;
use Stripe\Invoice;
use GuzzleHttp\Client;
use Illuminate\Support\Facades\Log;

class SubscriptionDetailsMail extends Mailable
{
    use Queueable, SerializesModels;

    public $subscriptionDetails;
    public $dealer;
    public $invoice;

    /**
     * Create a new message instance.
     *
     * @return void
     */
    public function __construct($subscriptionDetails, $dealerDetails, Invoice $invoice)
    {
        $this->subscriptionDetails = $subscriptionDetails;
        $this->dealer = $dealerDetails;
        $this->invoice = $invoice;
    }

    /**
     * Build the message.
     *
     * @return $this
     */
    public function build()
    {
        $pdfUrl = $this->invoice->invoice_pdf;

        // Log the URL for debugging
        Log::info('Retrieving Stripe invoice PDF', ['pdf_url' => $pdfUrl]);

        try {
            // Use Guzzle to retrieve the PDF content
            $client = new Client();
            $response = $client->get($pdfUrl);

            if ($response->getStatusCode() !== 200) {
                throw new \Exception('Failed to retrieve PDF: ' . $response->getReasonPhrase());
            }

            $fileContent = $response->getBody()->getContents();

            return $this->subject('Subscription Details')
                        ->view('emails.subscription')
                        ->attachData($fileContent, 'invoice.pdf', [
                            'mime' => 'application/pdf',
                        ])
                        ->with([
                            'subscriptionDetails' => $this->subscriptionDetails,
                            'dealer' => $this->dealer,
                        ]);
        } catch (\Exception $e) {
            // Log any errors
            Log::error('Error retrieving Stripe invoice PDF', ['error' => $e->getMessage()]);
            throw $e;
        }
    }
}
