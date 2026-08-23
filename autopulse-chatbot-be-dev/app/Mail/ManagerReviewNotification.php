<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class ManagerReviewNotification extends Mailable
{
    use Queueable, SerializesModels;

    public $userQuery;
    public $chatbotId;
    public $dealerName;
    public $conversationId;
    public $timestamp;

    /**
     * Create a new message instance.
     */
    public function __construct($userQuery, $chatbotId, $dealerName, $conversationId)
    {
        $this->userQuery = $userQuery;
        $this->chatbotId = $chatbotId;
        $this->dealerName = $dealerName;
        $this->conversationId = $conversationId;
        $this->timestamp = now()->format('Y-m-d H:i:s');
    }

    /**
     * Get the message envelope.
     */
    public function envelope(): Envelope
    {
        return new Envelope(
            subject: 'Manager Review Required - Chatbot Conversation',
        );
    }

    /**
     * Get the message content definition.
     */
    public function content(): Content
    {
        return new Content(
            view: 'emails.manager-review-notification',
        );
    }

    /**
     * Get the attachments for the message.
     *
     * @return array<int, \Illuminate\Mail\Mailables\Attachment>
     */
    public function attachments(): array
    {
        return [];
    }
}
