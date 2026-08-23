<?php 

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Conversation extends Model
{
    protected $connection = 'secondary_db';
    protected $table = 'conversations';
    //protected $primaryKey = 'conversation_id';
    public $timestamps = false; // if your table doesn't have timestamps columns
    protected $primaryKey = 'conversation_id';
     protected $fillable = [
        'conversation_id',
        'user_id', // Ensure this is added to fillable
        'request_token',
        'request_timestamp',
        'serialized_data',
        'finalresponse',
        'response_token',
        'context',
        'followup_id',
        'similarity',
        'response_url',
        'rawoutput',
        'response',
        'chat_source'
    ];
    // If 'conversation_id' is not an auto-incrementing integer, set incrementing to false
    public $incrementing = false;
    protected $casts = [
        'conversation_id' => 'string',
    ];

    public function followUps()
    {
        return $this->hasMany(Conversation::class, 'followup_id', 'conversation_id');
    }

    // Define relationship to the parent conversation (if this conversation is a follow-up)
    public function parentConversation()
    {
        return $this->belongsTo(Conversation::class, 'followup_id', 'conversation_id');
    }

    public function clicksVisitDealerWebsite()
    {
        return $this->hasMany(ConversionClick::class, 'conversion_id', 'conversation_id')
                    ->where('action', 'Visit_dealer_website');
    }

    // Relationship for clicks with action 'View_Vehicle'
    public function clicksViewVehicle()
    {
        return $this->hasMany(ConversionClick::class, 'conversion_id', 'conversation_id')
                    ->where('action', 'View_Vehicle');
    }

    // Relationship for clicks with action 'Vin_Reqeust_form'
    public function clicksVinRequestForm()
    {
        return $this->hasMany(ConversionClick::class, 'conversion_id', 'conversation_id')
                    ->where('action', 'Vin_Reqeust_form');
    }

    public function ConversionBooking()
    {
        return $this->hasMany(ConversionBooking::class, 'conversion_id', 'conversation_id');
    }

    // Relationship for clicks with action 'Explore_more'
    public function clicksExploreMore()
    {
        return $this->hasMany(ConversionClick::class, 'conversion_id', 'conversation_id')
                    ->where('action', 'Explore_more');
    }

    public function vinCopy()
    {
        return $this->hasMany(ConversionClick::class, 'conversion_id', 'conversation_id')
                    ->where('action', 'vin_copy');
    }
}
