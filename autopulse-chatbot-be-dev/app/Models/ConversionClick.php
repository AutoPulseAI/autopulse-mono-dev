<?php 

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ConversionClick extends Model
{
    protected $connection = 'secondary_db';
    protected $table = 'bot_click_action';
    //protected $primaryKey = 'conversation_id';
    protected $fillable = ['conversion_id','source','vin','action','otherdetail'];

    protected $casts = [
        'conversion_id' => 'string',
    ];

   
}
