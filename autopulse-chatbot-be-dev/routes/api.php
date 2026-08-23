<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Api\OpenSearchController;
use App\Http\Controllers\Dealer\DealerChatSettingController;
use App\Http\Controllers\ChatController;
use App\Http\Controllers\VehicleController;
use App\Http\Controllers\VisitController;
use App\Http\Controllers\Api\ConversionClickController;
use App\Http\Controllers\Api\MessengerWebhookController;

Route::post('/bot-click-action', [ConversionClickController::class, 'click']);
Route::post('/search/car/active', [OpenSearchController::class, 'searchCars']);
Route::post('/close_conversion', [ConversionClickController::class, 'sessionTime']);
Route::get('/close_conversion', [ConversionClickController::class, 'sessionTime']);
Route::post('/search/facet', [OpenSearchController::class, 'searchWithFacets']);
Route::get('/user', function (Request $request) {
    return $request->user();
})->middleware('auth:sanctum');
Route::get('/chatbot-settings/{user_id}', [DealerChatSettingController::class, 'getUserChatbotSettings']);
Route::post('chat', [ChatController::class, 'index']);
Route::get('/vehicle', [VehicleController::class, 'search']);
Route::get('/vehicledetail/{vin}', [VehicleController::class, 'getVehicleDetailApi']);
Route::post('/vehicel/adfMail', [VisitController::class, 'sendAdf']);
Route::post('/bookings', [VisitController::class, 'booking']);

//for messanger 


Route::prefix('webhook/facebook')->group(function () {
    // Verification endpoint (GET)
    Route::get('/', [MessengerWebhookController::class, 'verifyWebhook']);
    
    // Message handling endpoint (POST)
    Route::post('/', [MessengerWebhookController::class, 'handleWebhook']);
    
    // Test endpoint
    Route::post('/test', [MessengerWebhookController::class, 'testWebhook'])
        ->middleware('auth:dealer');
});
