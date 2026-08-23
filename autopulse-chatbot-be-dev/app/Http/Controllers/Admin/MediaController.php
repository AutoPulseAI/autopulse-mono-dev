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
use App\Models\Media;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Storage;
use App\Helpers\Slug;

class MediaController extends Controller
{

    use ApiResponseTrait;

    public function index(Request $request)
    {

        $input= $request->all() ;

        $media_list = Media::query()->makeQuery($input);
        
        return view('template.admin.media.index', compact('media_list'));
    }

    public function tableData(Request $request)
    {
        $request->merge(['page' => (($request->input('start')/ $request->input('length'))+1)]);
        $request->merge(['perPage' => $request->input('length')]);
      
        $this->perPage = $request->input('length', 3);
        $input= $request->all(); 
      
        $data = Media::query()->makeQuery($input)->paginate(  $this->perPage ); 
          
        return  response()->json([
            'data' => $data->items(),
            'draw' => $request->input('draw'), // Add draw parameter for security (optional)
            'recordsTotal' => $data->total(),
            'recordsFiltered' => $data->total(),
        ]);
    }

    public function uploadImage(Request $request) {    
        if($request->hasFile('upload')) {

                  $file = $request->file('upload');
                  $daytime = date('dmyHis');
      
                  $fileName = 'media-'.$daytime.'.'.  $file->getClientOriginalExtension();;
                  $t = Storage::disk('s3')->put($fileName, file_get_contents($file), 'media');
                  $file_path = Storage::disk('s3')->url($fileName);

          
                  $CKEditorFuncNum = $request->input('CKEditorFuncNum');
                  $url = $file_path; 
                  $msg = 'File uploaded successfully'; 
                  $response = "<script>window.parent.CKEDITOR.tools.callFunction($CKEditorFuncNum, '$url', '$msg')</script>";
                      
                  @header('Content-type: text/html; charset=utf-8'); 
                  echo $response;
        }
     } 

    public function store(Request $request){

        $validator = Validator::make($request->all(), [
            'title' => 'required',
        ]);    

    
        if ($validator -> fails()){
            $errors = $validator -> errors();
            return $this->respondWithError('Validation Message',$errors ,Response::HTTP_OK);   
        }
        
        $data = $request->all();

        $media = Media::find($request->media_id);

        if ($request->file('file')) {

            $file = $request->file('file');
            $daytime = date('dmyHis');

            $fileName = 'media-'.$daytime.'.'.  $file->getClientOriginalExtension();;
            $t = Storage::disk('s3')->put($fileName, file_get_contents($file), 'posts');
            $file_path = Storage::disk('s3')->url($fileName);

            if($request->file('is_media_file')){
                if(file_exists($media->file))
                {
                    unlink($media->file);
                }
            }

        }else{
            $file_path = $request->is_media_file;
        }

        $is_published ='false';
        if($request->is_published == 'true') {
            $is_published = 'true';
        }

        if(isset($request->media_id)) {
            $slug = Slug::instance(Media::class, 'slug')->createSlug($request->title,$request->media_id);
        }else{
            $slug = Slug::instance(Media::class, 'slug')->createSlug($request->title);
        }

        Media::updateOrCreate([
            'id' => $request->media_id,
        ],
        [
            'title'      => $data['title'],
            'slug'      => $slug,
            'content'       => $data['content']??'',
            'file'      => $file_path,
            'mediaurl'       => $data['mediaurl'],
            'is_published' => $is_published,
        ]);      

        return $this->respondWithSuccess(__( 'Media Created Successfully' ),[],Response::HTTP_OK);   
    
    }

    public function edit($id)
    {
        $media = Media::find($id);
        return response()->json($media);
    }

    public function show($id)
    {
        $media = Media::find($id);
        return view('template.admin.media.show', compact('media'));
    }

    //*Publish the Post */
    public function publish(Request $request)
    {
        try{
            $validator = Validator::make($request->all(), [
                'media_id'=>'required|exists:media,id',
                
            ]);      
            if ($validator -> fails()){
                return $this->respondWithError('Validation Message',$errors ,Response::HTTP_OK);  
            }
            
           // $input= $request->all(); 
            $input = ['is_published'=>true];
        
            $media= Media::where('id',$request->media_id)->first()->update($input); 
           
            return $this->respondWithSuccess(__( 'Media published Successfully' ), $media,Response::HTTP_OK);
        } catch (\Exception $e){
            DB::rollback();
            return $this->respondWithError('Something Went Wrong !',$e->getMessage(),Response::HTTP_INTERNAL_SERVER_ERROR);
        } 
    }

    //*Draf the Post */
    public function draft(Request $request)
    {
        try{
            $validator = Validator::make($request->all(), [
                'media_id'=>'required|exists:media,id',
                
            ]);      
            if ($validator -> fails()){
                return $this->respondWithError('Validation Message',$errors ,Response::HTTP_OK);  
            }
            
           // $input= $request->all(); 
            $input = ['is_published'=>false];
        
            $media= Media::where('id',$request->media_id)->first()->update($input);
           
            return $this->respondWithSuccess(__( 'Media drafted Successfully' ), $media,Response::HTTP_OK);
        } catch (\Exception $e){
            DB::rollback();
            return $this->respondWithError('Something Went Wrong !',$e->getMessage(),Response::HTTP_INTERNAL_SERVER_ERROR);
        } 
    }

    public function delete(Request $request)
    {
        try{
            $validator = Validator::make($request->all(), [
                'media_id'=>'required|exists:media,id',
            ]);
            if ($validator -> fails()){
                $errors = $validator -> errors();
                return $this->respondWithError('Validation Message',$errors ,Response::HTTP_OK);
            }
            $media = Media::where('id',$request->media_id)->first()->delete();
            return $this->respondWithSuccess(__( 'Post Deleted Successfully' ), $media,Response::HTTP_OK);
        } catch (\Exception $e){
            DB::rollback();
            return $this->respondWithError('Something Went Wrong !',$e->getMessage(),Response::HTTP_INTERNAL_SERVER_ERROR);
        } 
    }


}
