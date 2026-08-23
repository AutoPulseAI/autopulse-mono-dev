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
use App\Models\Post;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Storage;
use App\Helpers\Slug;

class PostController extends Controller
{

    use ApiResponseTrait;

    public function index(Request $request)
    {

        $input= $request->all() ;

        $post_list = Post::query()->makeQuery($input);
        
        return view('template.admin.post.index', compact('post_list'));
    }

    public function tableData(Request $request)
    {
        $request->merge(['page' => (($request->input('start')/ $request->input('length'))+1)]);
        $request->merge(['perPage' => $request->input('length')]);
      
        $this->perPage = $request->input('length', 3);
        $input= $request->all(); 
      
        $data = Post::query()->makeQuery($input)->paginate(  $this->perPage ); 
          
        return  response()->json([
            'data' => $data->items(),
            'draw' => $request->input('draw'), // Add draw parameter for security (optional)
            'recordsTotal' => $data->total(),
            'recordsFiltered' => $data->total(),
        ]);
    }

    public function uploadImage(Request $request) {    
        if($request->hasFile('upload')) {

                  $image = $request->file('upload');
                  $daytime = date('dmyHis');
      
                  $imageName = 'post-'.$daytime.'.'.  $image->getClientOriginalExtension();;
                  $t = Storage::disk('s3')->put($imageName, file_get_contents($image), 'posts');
                  $image_path = Storage::disk('s3')->url($imageName);

          
                  $CKEditorFuncNum = $request->input('CKEditorFuncNum');
                  $url = $image_path; 
                  $msg = 'Image uploaded successfully'; 
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

        if ($request->hasFile('image')) {

            $image = $request->file('image');
            $daytime = date('dmyHis');

            $imageName = 'post-'.$daytime.'.'.  $image->getClientOriginalExtension();;
            $t = Storage::disk('s3')->put($imageName, file_get_contents($image), 'posts');
            $image_path = Storage::disk('s3')->url($imageName);

            if($request->post_id)
            {
                $post = Post::find($request->post_id);
                if(file_exists($post->image))
                {
                    unlink($post->image);
                }
            }


        }else{
            $image_path = $request->is_post_image;
        }

        $is_published ='false';
        if($request->is_published == 'true') {
            $is_published = 'true';
        }

        if(isset($request->post_id)) {
            $slug = Slug::instance(Post::class, 'slug')->createSlug($request->title,$request->post_id);
        }else{
            $slug = Slug::instance(Post::class, 'slug')->createSlug($request->title);
        }

        Post::updateOrCreate([
            'id' => $request->post_id,
        ],
        [
            'title'      => $data['title'],
            'slug'      => $slug,
            'body'       => $data['body'],
            'meta_tag'   => $data['meta_tag'],
            'meta_description'  => $data['meta_description'],
            'keywords'   => $data['keywords'],
            'image'      => $image_path,
            'author'       => $data['author'],
            'excerpts'       => $data['excerpts'],
            'is_published' => $is_published,
        ]);      

        return $this->respondWithSuccess(__( 'Post Created Successfully' ),[],Response::HTTP_OK);   
    
    }

    public function edit($id)
    {
        $post = Post::find($id);
        return response()->json($post);
    }

    public function show($id)
    {
        $post = Post::find($id);
        return view('template.admin.post.show', compact('post'));
    }

    //*Publish the Post */
    public function publish(Request $request)
    {
        try{
            $validator = Validator::make($request->all(), [
                'post_id'=>'required|exists:posts,id',
                
            ]);      
            if ($validator -> fails()){
                return $this->respondWithError('Validation Message',$errors ,Response::HTTP_OK);  
            }
            
           // $input= $request->all(); 
            $input = ['is_published'=>true];
        
            $post= Post::where('id',$request->post_id)->first()->update($input); 
           
            return $this->respondWithSuccess(__( 'Post published Successfully' ), $post,Response::HTTP_OK);
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
                'post_id'=>'required|exists:posts,id',
                
            ]);      
            if ($validator -> fails()){
                return $this->respondWithError('Validation Message',$errors ,Response::HTTP_OK);  
            }
            
           // $input= $request->all(); 
            $input = ['is_published'=>false];
        
            $post= Post::where('id',$request->post_id)->first()->update($input);
           
            return $this->respondWithSuccess(__( 'Post drafted Successfully' ), $post,Response::HTTP_OK);
        } catch (\Exception $e){
            DB::rollback();
            return $this->respondWithError('Something Went Wrong !',$e->getMessage(),Response::HTTP_INTERNAL_SERVER_ERROR);
        } 
    }

    public function delete(Request $request)
    {
        try{
            $validator = Validator::make($request->all(), [
                'post_id'=>'required|exists:posts,id',
            ]);
            if ($validator -> fails()){
                $errors = $validator -> errors();
                return $this->respondWithError('Validation Message',$errors ,Response::HTTP_OK);
            }
            $post = Post::where('id',$request->post_id)->first()->delete();
            return $this->respondWithSuccess(__( 'Post Deleted Successfully' ), $post,Response::HTTP_OK);
        } catch (\Exception $e){
            DB::rollback();
            return $this->respondWithError('Something Went Wrong !',$e->getMessage(),Response::HTTP_INTERNAL_SERVER_ERROR);
        } 
    }


}
