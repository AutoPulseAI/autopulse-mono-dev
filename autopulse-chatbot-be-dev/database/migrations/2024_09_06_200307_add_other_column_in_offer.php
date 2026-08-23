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
        Schema::table('offer', function (Blueprint $table) {
            $table->string('make')->nullable();
            $table->integer('store_id')->nullable();
            $table->string('model')->nullable();
            $table->string('trim')->nullable();
            $table->string('transmission')->nullable();
            $table->string('drivetrain')->nullable();
            $table->string('price')->nullable();
            $table->string('year')->nullable();
            $table->string('engine')->nullable();
            $table->string('body_type')->nullable();
            $table->string('miles')->nullable();
            $table->string('car_type')->nullable();
            $table->text('feature_image')->nullable();
            
        });
        Schema::table('chatbot_settings', function (Blueprint $table) {
            $table->string('adf_mail')->nullable();
          
            
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('offer', function (Blueprint $table) {
            $table->dropColumn('make');
            $table->dropColumn('store_id');
            $table->dropColumn('model');
            $table->dropColumn('trim');
            $table->dropColumn('transmission');
            $table->dropColumn('drivetrain');
            $table->dropColumn('price');
            $table->dropColumn('year');
            $table->dropColumn('engine');
            $table->dropColumn('body_type');
            $table->dropColumn('miles');
            $table->dropColumn('car_type');
            $table->dropColumn('feature_image');
            
        });
        Schema::table('chatbot_settings', function (Blueprint $table) {
           $table->dropColumn('adf_mail');
        });
    }
};
