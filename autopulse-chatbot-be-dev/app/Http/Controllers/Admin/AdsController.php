<?php

namespace App\Http\Controllers\Admin;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use App\Http\Controllers\Controller;
use Illuminate\Support\Facades\Validator;
use Illuminate\Http\Response;
use App\Http\Traits\ApiResponseTrait;
use Illuminate\Support\Facades\DB;
use Carbon\Carbon;
use Illuminate\Support\Facades\Mail;
use App\Models\Ads;


class AdsController extends Controller
{

    use ApiResponseTrait;

    public function index(Request $request)
    {

        $input= $request->all() ;

        $ads_list = Ads::query()->makeQuery($input);
        
        return view('template.admin.ads.index', compact('ads_list'));
    }

    public function tableData(Request $request)
    {
        $request->merge(['page' => (($request->input('start')/ $request->input('length'))+1)]);
        $request->merge(['perPage' => $request->input('length')]);
      
        $this->perPage = $request->input('length', 3);
        $input= $request->all(); 
      
        $data = Ads::query()->makeQuery($input)->paginate(  $this->perPage );
          
        return  response()->json([
            'data' => $data->items(),
            'draw' => $request->input('draw'), // Add draw parameter for security (optional)
            'recordsTotal' => $data->total(),
            'recordsFiltered' => $data->total(),
        ]);
    }

    public function create()
    {
        return view('template.admin.ads.create');
    }

    public function store(Request $request){

        $validator = Validator::make($request->all(), [
            'page' => 'required',
            'slot' => 'required',  
            'name' => 'required',
            'adcode' => 'required',
        ]);    

    
        if ($validator -> fails()){
            $errors = $validator -> errors();
            return $this->respondWithError('Validation Message',$errors ,Response::HTTP_OK);   
        }

        $enabled ='false';
        if($request->ads_enabled == 'true') {
            $enabled = 'true';
        }

        Ads::updateOrCreate([
            'id' => $request->ads_id,
        ],
        [
            'page' => $request->page,
            'slot' => $request->slot,
            'name' => $request->name,
            'code' => $request->adcode,
            'enabled' => $enabled,
        ]);      

        return $this->respondWithSuccess(__( 'Ad Created Successfully' ),[],Response::HTTP_OK);   
    
    }

    public function edit($id)
    {
        $ads = Ads::find($id);
        return response()->json($ads);
    }

    public function show($id)
    {
        $ads = Ads::find($id);
        return view('template.admin.ads.show', compact('ads'));
    }

    //*Enable the Ad */
    public function enable(Request $request)
    {
        try{
            $validator = Validator::make($request->all(), [
                'ads_id'=>'required|exists:cads,id',
                
            ]);      
            if ($validator -> fails()){
                return $this->respondWithError('Validation Message',$errors ,Response::HTTP_OK);  
            }
            
           // $input= $request->all(); 
            $input = ['enabled'=>true];
        
            $ads= Ads::where('id',$request->ads_id)->first()->update($input);
           
            return $this->respondWithSuccess(__( 'Ad enabled Successfully' ), $ads,Response::HTTP_OK);
        } catch (\Exception $e){
            DB::rollback();
            return $this->respondWithError('Something Went Wrong !',$e->getMessage(),Response::HTTP_INTERNAL_SERVER_ERROR);
        } 
    }

     //*Disable the Ad */
     public function disable(Request $request)
    {
        try{
            $validator = Validator::make($request->all(), [
                'ads_id'=>'required|exists:cads,id',
                
            ]);      
            if ($validator -> fails()){
                return $this->respondWithError('Validation Message',$errors ,Response::HTTP_OK);  
            }
            
           // $input= $request->all(); 
            $input = ['enabled'=>false];
        
            $ads= Ads::where('id',$request->ads_id)->first()->update($input);
           
            return $this->respondWithSuccess(__( 'Ad disabled Successfully' ), $ads,Response::HTTP_OK);
        } catch (\Exception $e){
            DB::rollback();
            return $this->respondWithError('Something Went Wrong !',$e->getMessage(),Response::HTTP_INTERNAL_SERVER_ERROR);
        } 
    }


    public function delete(Request $request)
    {
        try{
            $validator = Validator::make($request->all(), [
                'ads_id'=>'required|exists:cads,id',
            ]);
            if ($validator -> fails()){
                $errors = $validator -> errors();
                return $this->respondWithError('Validation Message',$errors ,Response::HTTP_OK);
            }
            $ads = Ads::where('id',$request->ads_id)->first()->delete();
            return $this->respondWithSuccess(__( 'Ad Deleted Successfully' ), $ads,Response::HTTP_OK);
        } catch (\Exception $e){
            DB::rollback();
            return $this->respondWithError('Something Went Wrong !',$e->getMessage(),Response::HTTP_INTERNAL_SERVER_ERROR);
        } 
    }


    public function adsPublish(Request $request , $id)
    {
      
        try{
            
            $position = Position::where('id',$request->id)->first();

            $position->publish = 1;

            $position->save();
           
              return response()->json([
                'id'=>$request->id,
                'success'=>true,
                'message'=>'Project Published Successfully'
                
            ],200);
        } catch (\Exception $e){
           
              return response()->json([
                'success'=>false,
                'message'=>'Some Error'
               
            ],200);
        } 
    }

}
