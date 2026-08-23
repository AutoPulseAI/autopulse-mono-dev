<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class ChatSetting extends Model
{
    use HasFactory;
    protected $table = 'chatbot_settings';
    protected $fillable = [
        'store_id',
        'uuid',
        'dealer_id',
        'dealership_url',
        'logo',
        'adf_mail',
        'icon_logo',
        'dealership_name',
        'chatbot_name',
        'primary_color',
        'secondary_color',
        'welcome_message',
        'position',
        // Store Address Information
        'store_address',
        'store_city',
        'store_state',
        'store_zip',
        'store_country',
        // Contact Person Information
        'contact_person_name',
        'contact_person_phone',
        'contact_person_email',
        // Managerial Contact Information
        'managerial_contact_phone',
        'managerial_contact_email',
        // Timezone and Store Hours
        'timezone',
        'store_hours',
        'is_store_hours_enabled',
        'closed_message'
    ];

    /**
     * The attributes that should be cast.
     */
    protected $casts = [
        'store_hours' => 'array',
        'is_store_hours_enabled' => 'boolean',
    ];

    public function dealer(){
        return $this->belongsTo(Dealer::class,'dealer_id','id');
    }
    public function scopeMakeQuery($query, $data)
    {

        $model = $this->query()->with('dealer');
       
        if($this->checkExistinArray('id',$data))  $model = $model->where('id',$data['id']);
       
      
        if ($this->checkExistinArray('search', $data)) {
            $searchValue = $data['search']['value'];
          
            if($searchValue){
                
                $model = $model->where(function ($query) use ($searchValue) {
                    $query->where('name', 'like', '%' . $searchValue . '%')
                
                    ->orWhere('email', 'like', '%' . $searchValue . '%')
                    ->orWhere('dealership_group', 'like', '%' . $searchValue . '%');
                   
                });

            }
        }

        if($this->checkExistinArray('start_date',$data))  $model = $model->where('start_date','>=',$data['start_date']);
        if($this->checkExistinArray('end_date',$data))  $model = $model->where('end_date','>=',$data['end_date']);
        if ($this->checkExistinArray('order', $data)) {
            $orderColumn = $data['order'][0]['column'];
            $orderDirection = $data['order'][0]['dir'];
    
            $orderColumns = ['id', 'name', 'email', 'phone_number', 'dealership_name', 'dealership_name', 'adf_mail','created_at'];
    
            $orderBy = isset($orderColumns[$orderColumn]) ? $orderColumns[$orderColumn] : 'id';
    
            $model = $model->orderBy($orderBy, $orderDirection);
        }else{
            $model = $model->orderBy('id', 'desc');
        }
        
        return $model;
       
    }

    public function checkExistinArray($key,$data,$dafault=false)
    {
       return  isset($data[$key]) && $data[$key]!=''?true:$dafault;
    }

    /**
     * Get default store hours structure
     */
    public static function getDefaultStoreHours()
    {
        return [
            'monday' => ['open' => '09:00', 'close' => '18:00', 'closed' => false],
            'tuesday' => ['open' => '09:00', 'close' => '18:00', 'closed' => false],
            'wednesday' => ['open' => '09:00', 'close' => '18:00', 'closed' => false],
            'thursday' => ['open' => '09:00', 'close' => '18:00', 'closed' => false],
            'friday' => ['open' => '09:00', 'close' => '18:00', 'closed' => false],
            'saturday' => ['open' => '09:00', 'close' => '17:00', 'closed' => false],
            'sunday' => ['open' => '12:00', 'close' => '16:00', 'closed' => true]
        ];
    }

    /**
     * Check if store is currently open
     */
    public function isStoreOpen($currentTime = null)
    {
        if (!$this->is_store_hours_enabled || !$this->store_hours) {
            return true; // Always open if hours not configured
        }

        $currentTime = $currentTime ?: now($this->timezone);
        $dayOfWeek = strtolower($currentTime->format('l'));
        
        if (!isset($this->store_hours[$dayOfWeek])) {
            return false;
        }

        $dayHours = $this->store_hours[$dayOfWeek];
        
        // If marked as closed
        if ($dayHours['closed'] ?? false) {
            return false;
        }

        $openTime = $currentTime->copy()->setTimeFromTimeString($dayHours['open']);
        $closeTime = $currentTime->copy()->setTimeFromTimeString($dayHours['close']);

        return $currentTime->between($openTime, $closeTime);
    }

    /**
     * Get formatted store hours for display
     */
    public function getFormattedStoreHours()
    {
        if (!$this->store_hours) {
            return [];
        }

        $formatted = [];
        foreach ($this->store_hours as $day => $hours) {
            $formatted[ucfirst($day)] = ($hours['closed'] ?? false) 
                ? 'Closed' 
                : date('g:i A', strtotime($hours['open'])) . ' - ' . date('g:i A', strtotime($hours['close']));
        }

        return $formatted;
    }

    /**
     * Get full store address as a string
     */
    public function getFullAddressAttribute()
    {
        $address = [];
        
        if ($this->store_address) $address[] = $this->store_address;
        if ($this->store_city) $address[] = $this->store_city;
        if ($this->store_state) $address[] = $this->store_state;
        if ($this->store_zip) $address[] = $this->store_zip;
        if ($this->store_country && $this->store_country !== 'USA') $address[] = $this->store_country;

        return implode(', ', $address);
    }

    /**
     * Get next opening time if store is currently closed
     */
    public function getNextOpeningTime($currentTime = null)
    {
        if (!$this->is_store_hours_enabled || !$this->store_hours) {
            return null;
        }

        $currentTime = $currentTime ?: now($this->timezone);
        $days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        
        // Check next 7 days
        for ($i = 0; $i < 7; $i++) {
            $checkDate = $currentTime->copy()->addDays($i);
            $dayOfWeek = strtolower($checkDate->format('l'));
            
            if (isset($this->store_hours[$dayOfWeek]) && !($this->store_hours[$dayOfWeek]['closed'] ?? false)) {
                $openTime = $checkDate->copy()->setTimeFromTimeString($this->store_hours[$dayOfWeek]['open']);
                
                // If it's today and opening time hasn't passed, or if it's a future day
                if ($i > 0 || $openTime->greaterThan($currentTime)) {
                    return $openTime;
                }
            }
        }

        return null;
    }
    
}
