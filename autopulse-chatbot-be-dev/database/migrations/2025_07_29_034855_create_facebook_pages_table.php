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
        Schema::create('facebook_pages', function (Blueprint $table) {
            $table->id();
            $table->string('dealer_id');
            $table->string('page_id'); // Facebook Page ID
            $table->string('verify_token');      // Custom token per page
            $table->string('access_token');      // Page Access Token
            $table->string('page_name')->nullable();
            $table->smallInteger('is_active'); 
            $table->timestamps();
            
            // Allow multiple pages per dealer, but unique combination of dealer_id and page_id
            $table->unique(['dealer_id', 'page_id']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('facebook_pages');
    }
};
