<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('chatbot_settings', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('store_id');
            $table->unsignedBigInteger('dealer_id');
            $table->string('uuid')->nullable();
            $table->string('dealership_url')->nullable();
            $table->string('dealership_name')->nullable();
            $table->text('logo')->nullable(); // Path to the logo file
            $table->text('icon_logo')->nullable();
            $table->string('chatbot_name')->nullable();
            $table->string('primary_color')->nullable();
            $table->string('secondary_color')->nullable();
            $table->text('welcome_message')->nullable();
            $table->timestamps();
        
          
        });
        
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('chatbot_settings');
    }
};
