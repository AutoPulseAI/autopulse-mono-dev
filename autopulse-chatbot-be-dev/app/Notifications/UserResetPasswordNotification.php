<?php

namespace App\Notifications;

use Illuminate\Notifications\Notification;
use Illuminate\Notifications\Messages\MailMessage;

class UserResetPasswordNotification extends Notification
{
    public $token;

    public function __construct($token)
    {
        $this->token = $token;
    }

    public function via($notifiable)
    {
        return ['mail'];
    }

    public function toMail($notifiable)
    {
        $resetUrl = url('/user-reset', $this->token);
        return (new MailMessage)
            ->subject('Reset Password Notification')
            ->markdown('emails.userreset', ['resetUrl' => $resetUrl, 'user' => $notifiable]);
    }
}
