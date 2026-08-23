<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Factories\HasFactory;

class FacebookBookingTracking extends Model
{
    use HasFactory;

    protected $table = 'facebook_booking_tracking';

    protected $fillable = [
        'dealer_id',
        'user_id',
        'conversation_id',
        'vehicle_id',
        'vehicle_title',
        'utm_source',
        'source_type',
        'page_id',
        'sender_id',
        'session_id',
        'visited_at',
        'converted_at',
        'booking_id',
        'status',
        'additional_data'
    ];

    protected $casts = [
        'visited_at' => 'datetime',
        'converted_at' => 'datetime',
        'additional_data' => 'array'
    ];

    /**
     * Get the dealer that owns the tracking record.
     */
    public function dealer(): BelongsTo
    {
        return $this->belongsTo(Dealer::class);
    }

    /**
     * Get the user that owns the tracking record.
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Get the booking that this tracking record led to.
     */
    public function booking(): BelongsTo
    {
        return $this->belongsTo(Booking::class);
    }

    /**
     * Scope for Facebook Messenger tracking
     */
    public function scopeFromFacebook($query)
    {
        return $query->where('source_type', 'facebook_messenger');
    }

    /**
     * Scope for specific status
     */
    public function scopeWithStatus($query, $status)
    {
        return $query->where('status', $status);
    }

    /**
     * Scope for converted tracking records
     */
    public function scopeConverted($query)
    {
        return $query->where('status', 'converted');
    }

    /**
     * Scope for tracking records that led to bookings
     */
    public function scopeWithBooking($query)
    {
        return $query->whereNotNull('booking_id');
    }

    /**
     * Generate a unique session ID
     */
    public static function generateSessionId(): string
    {
        return uniqid('fb_', true);
    }

    /**
     * Update status to started form
     */
    public function markFormStarted(): void
    {
        $this->update(['status' => 'started_form']);
    }

    /**
     * Update status to completed form
     */
    public function markFormCompleted(): void
    {
        $this->update(['status' => 'completed_form']);
    }

    /**
     * Update status to converted and link to booking
     */
    public function markConverted(int $bookingId): void
    {
        $this->update([
            'status' => 'converted',
            'booking_id' => $bookingId,
            'converted_at' => now()
        ]);
    }

    /**
     * Get conversion rate for a dealer
     */
    public static function getConversionRate(int $dealerId, $startDate = null, $endDate = null): float
    {
        $query = static::where('dealer_id', $dealerId);
        
        if ($startDate) {
            $query->where('visited_at', '>=', $startDate);
        }
        
        if ($endDate) {
            $query->where('visited_at', '<=', $endDate);
        }

        $totalVisits = $query->count();
        $conversions = $query->where('status', 'converted')->count();

        return $totalVisits > 0 ? ($conversions / $totalVisits) * 100 : 0;
    }

    /**
     * Get tracking analytics for a dealer
     */
    public static function getDealerAnalytics(int $dealerId, $startDate = null, $endDate = null): array
    {
        $query = static::where('dealer_id', $dealerId);
        
        if ($startDate) {
            $query->where('visited_at', '>=', $startDate);
        }
        
        if ($endDate) {
            $query->where('visited_at', '<=', $endDate);
        }

        $totalVisits = $query->count();
        $formStarts = $query->where('status', 'started_form')->count();
        $formCompletions = $query->where('status', 'completed_form')->count();
        $conversions = $query->where('status', 'converted')->count();

        return [
            'total_visits' => $totalVisits,
            'form_starts' => $formStarts,
            'form_completions' => $formCompletions,
            'conversions' => $conversions,
            'conversion_rate' => $totalVisits > 0 ? ($conversions / $totalVisits) * 100 : 0,
            'form_start_rate' => $totalVisits > 0 ? ($formStarts / $totalVisits) * 100 : 0,
            'form_completion_rate' => $formStarts > 0 ? ($formCompletions / $formStarts) * 100 : 0
        ];
    }
}
