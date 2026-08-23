@extends('layouts.admin')
@section('content')
<input type="hidden" id="seturl" value="">
<!-- Page Content Start -->
<div class="admin_inner_content bg-white">
    <div class="row">
        <div class="page_title d-flex align-items-center">
            <h2 class="mb-0">Posts</h2>
            <div class="page_title_btn ms-auto">
                <button class="btn btn_theme" id="createPost">Add Post</button>
            </div>
        </div>
    </div>
    @if(session()->has('success'))
        <div class="row">
            <div class="alert alert-success alert-dismissible text-white" role="alert">
                <span class="text-sm">{{ Session::get('success') }}</span>
                <button type="button" class="btn-close text-lg py-3 opacity-10"
                    data-bs-dismiss="alert" aria-label="Close">
                    <span aria-hidden="true">&times;</span>
                </button>
            </div>
        </div>
    @endif
    <hr>

    <div class="row">
        
        <div class="col col-12">
            <div class="position-relative table-responsive">
                <table class="table table-bordered w-100 dataTable" id="post_tabl">
                    <thead>
                        <tr>
                            <td>#</td>
                            <td>Title</td>
                            <td>Slug</td>
                            <td>Author</td>
                            <td>Date</td>
                            <td>Action</td>
                        </tr>
                    </thead>
                   
                </table>

            </div>
        </div>
    </div>
</div>


<!-- Ad -->
<div class="modal fade" id="postModal" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-xl">
        <div class="modal-content">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 id="postHeading" class="modal-title"></h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body">
                    <form action="{{ route('post.store') }}" id="postForm" method="post" enctype="multipart/form-data">
                        <input type="hidden" name="post_id" id="post_id" >
                        <input type="hidden" name="is_published" id="is_published">
                        <input type="hidden" name="is_post_image" id="is_post_image">
                        @csrf
                        <div class="row">
                           
                            <div class="col col-lg-6 col-md-6 col-12">
                                <div class="mb-3">
                                    <label class="form-label">Title</label>
                                    <input type="text" id="post-title" class="form-control required"  name="title">
                                </div>
                                <div class="mb-3">
                                    <label class="form-label">Image</label>
                                    <input type="file" id="post-image" class="form-control"  name="image">
                                </div>
                                <div class="mb-3">
                                    <label class="form-label">Author</label>
                                    <input type="text" id="post-author" class="form-control"  name="author">
                                </div>
                            </div>
                            <div class="col col-lg-6 col-md-6 col-12 text-center">
                                <div class="mb-3">
                                    <label class="form-label"></label>
                                    <div id="view-post-image"></div>
                                    <div id="img-info-msg" class="pt-1"></div>
                                </div>
                            </div>
                            <div class="col col-lg-12 col-md-12 col-12">
                                <div class="mb-3">
                                    <label class="form-label">Excerpts</label>
                                    <textarea type="text" id="post-excerpts" class="form-control"  name="excerpts" cols="2" rows="2"></textarea>
                                </div>
                            </div>
                            <div class="col col-lg-12 col-md-12 col-12">
                                <div class="mb-3">
                                    <label class="form-label">Body</label>
                                    <textarea type="text" id="post-body" class="form-control"  name="body" rows="20"></textarea>
                                </div>
                            </div>
                            <div class="col col-lg-6 col-md-6 col-6" style="display:none;">
                                <div class="mb-3">
                                    <label class="form-label">Tags</label>
                                    <textarea type="text" id="post-tags" class="form-control"  name="tags" cols="2" rows="2"></textarea>
                                </div>
                            </div>
                            <div class="col col-lg-12 col-md-12 col-12" style="">
                                <div class="mb-3">
                                    <label class="form-label">Meta Title</label>
                                    <textarea type="text" id="post-meta-tag" class="form-control"  name="meta_tag" cols="2" rows="2"></textarea>
                                </div>
                            </div>
                            <div class="col col-lg-12 col-md-12 col-12" >
                                <div class="mb-3">
                                    <label class="form-label">Meta Description</label>
                                    <textarea type="text" id="post-meta-desc" class="form-control"  name="meta_description" cols="2" rows="2"></textarea>
                                </div>
                            </div>
                            <div class="col col-lg-6 col-md-6 col-6" style="display:none;">
                                <div class="mb-3">
                                    <label class="form-label">Focus Keywords</label>
                                    <textarea type="text" id="post-keywords" class="form-control"  name="keywords" cols="2" rows="2"></textarea>
                                </div>
                            </div>

                        </div>
                        
                        <div class="row">
                            <div class="col col-12 text-center">
                                <button type="submit" id="postsubmit" class="btn btn_theme" value="create">Submit</button>
                            </div>
                        </div>  

                    </form>
                </div>
            </div>
        </div>
    </div>
</div>

<!-- Published -->
<div  class="modal fade" id="publishedModal" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
        <div class="modal-header border-0">
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
        </div>
        <div class="modal-body pb-4">
            <div class="position-relative text-center">
                <i class="fa-regular fa-circle-check fa-4x mb-3 text-success"></i>
                <h5 class="mb-4">Are you sure? You want to publish post?</h5>
                <div class="position-relative text-center">                    
                    <button  type="button" class="btn btn_theme" onclick="actionmethod()">Yes</a>
                    <button type="button" class="btn btn_dark ms-2" data-bs-dismiss="modal" aria-label="Close">Cancel</button>
                </div>
            </div>
        </div>
        </div>
    </div>
</div>

<!-- Drafted -->
<div  class="modal fade" id="draftedModal" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
        <div class="modal-header border-0">
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
        </div>
        <div class="modal-body pb-4">
            <div class="position-relative text-center">
                <i class="fa-regular fa-circle-xmark fa-4x mb-3 text-danger"></i>
                <h5 class="mb-4">Are you sure? You want to draft post?</h5>
                <div class="position-relative text-center">                    
                    <button  type="button" class="btn btn_theme" onclick="actionmethod()">Yes</a>
                    <button type="button" class="btn btn_dark ms-2" data-bs-dismiss="modal" aria-label="Close">Cancel</button>
                </div>
            </div>
        </div>
        </div>
    </div>
</div>

<!-- Delete -->
<div  class="modal fade" id="deleteModal" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
        <div class="modal-header border-0">
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
        </div>
        <div class="modal-body pb-4">
            <div class="position-relative text-center">
                <i class="fa-regular fa-circle-xmark fa-4x mb-3 text-danger"></i>
                <h5 class="mb-4">Are you sure? You want to delete?</h5>
                <div class="position-relative text-center">                    
                    <button  type="button" class="btn btn-danger" onclick="actionmethod()">Yes</a>
                    <button type="button" class="btn btn-secondary ms-2" data-bs-dismiss="modal" aria-label="Close">Cancel</button>
                </div>
            </div>
        </div>
        </div>
    </div>
</div>
@endsection
@section('script')
<script src="//cdn.ckeditor.com/4.14.1/standard/ckeditor.js"></script>
<script type="text/javascript">
$(document).ready(function () {
    //$('.ckeditor').ckeditor();
    //CKEDITOR.replace('post-body', { format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'});
    CKEDITOR.replace('post-body', {
        filebrowserUploadUrl: "{{route('post.upload', ['_token' => csrf_token() ])}}",
        filebrowserUploadMethod: 'form',
        format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'
    });
});

/*function readURL(input) {
  if (input.image && input.image[0]) {
    var reader = new FileReader();

    reader.onload = function(e) {
      $('#imagePreview').attr('src', e.target.result);
    }

    reader.readAsDataURL(input.files[0]);
  }
}*/
</script>
<script type="text/javascript">
var post ='';
var myurl = '{{route('post.tableData')}}';
$(function () {

    $('#createPost').click(function () {
        $('#postsubmit').val("create-post");
        $('#post_id').val('');
        $('#is_published').val('');
        $('#is_post_image').val('');
        $("#img-info-msg").empty();
        $("#view-post-image").empty();
        $("#img-info-msg").html(`<i class="fa fa-info-circle"></i> Default Image`);
        CKEDITOR.instances["post-body"].setData('');
        $("#view-post-image").html(`<img src="{{asset('assets/images/active.png')}}" width="300" height="200" class="object-fit-fill border rounded">`);
        $('#postForm').trigger("reset");
        $('#postHeading').html("Create Post");
        $('#postModal').modal('show');
    });

    $('body').on('click', '.editPost', function () {
        var post_id = $(this).data('id');
        $.get("{{ route('post.index') }}" +'/' + post_id +'/edit', function (data) {
            $('#postHeading').html("Edit Post");
            $('#postsubmit').val("edit-post");
            $('#postModal').modal('show');
            $('#postForm').trigger("reset");
            $('#post_id').val(data.id);
            $('#is_published').val(data.is_published);
            $('#post-title').val(data.title);
            //$('#post-body').val(data.body);
            CKEDITOR.instances["post-body"].setData(data.body);
            if (data.image) {
                $("#img-info-msg").html(`<i class="fa fa-info-circle"></i> Featured Image`);
                $("#view-post-image").html(`<img src="`+data.image+`" width="300" height="200" class="object-fit-fill border rounded">`);
            }else{
                $("#img-info-msg").html(`<i class="fa fa-info-circle"></i> Default Image`);
                $("#view-post-image").html(`<img src="{{asset('assets/images/active.png')}}" width="300" height="200" class="object-fit-fill border rounded">`);  
            }
            $("#is_post_image").val(data.image);
            $('#post-author').val(data.author);
            $('#post-excerpts').val(data.excerpts);
            $('#post-meta-tag').val(data.meta_tag);
            $('#post-meta-desc').val(data.meta_description);
            $('#post-keywords').val(data.keywords);
        });
    });

});

post= $('#post_tabl').DataTable({
    processing: true,
    serverSide: true,
    ajax: {
        url:   '{{route('post.tableData')}}?source=post',
        type: 'GET',
    },
    columns: [
        { data: 'id', name: 'id' },
        { data: 'title', name: 'title' },
        { data: 'slug', name: 'slug' },
        { data: 'author', name: 'author' },
        {
            data: 'created_at',
            name: 'created_at',
            render: function (data, type, row) {
                if (type === 'display' || type === 'filter') {
                    return moment(data).format('DD-MM-YYYY HH:mm:ss'); // Adjust the format as needed
                }
                return data;
            },
        },
        
        {
            data: null,
            orderable: false, // Disable sorting on this column
            searchable: false, // Disable searching on this column
            render: function (data, type, row) {
               
                viewurl = `{{ route('blog_list') }}/`+row.slug;
                publishedurl = `{{ route('post.publish') }}`+'?post_id='+row.id
                draftedurl = `{{ route('post.draft') }}`+'?post_id='+row.id;
                deleteurl = `{{ route('post.delete') }}`+'?post_id='+row.id;

                var viewButton = `<a href="`+viewurl+`" class="btn btn-dark btn-sm">View</a>`;

                var publishButton = row.is_published
                    ? `<button class="btn btn-outline-success btn-sm" data-bs-toggle="modal" data-bs-target="#draftedModal"
                        onclick="seturl('`+draftedurl+`')">
                        Published
                    </button>`
                    : `<button class="btn btn-outline-danger btn-sm" data-bs-toggle="modal" data-bs-target="#publishedModal"
                        onclick="seturl('`+publishedurl+`')">
                        Draft
                    </button>`;

                var editButton = `<button class="btn btn-primary btn-sm editPost" data-id="`+row.id+`">Edit</button>`;

                var deleteButton = `<button class="btn btn-outline-secondary btn-sm" data-bs-toggle="modal" data-bs-target="#deleteModal"
                onclick="seturl('`+deleteurl+`')">
                Delete
                </button>`;
                return publishButton +' '+ viewButton +' '+ editButton +' '+ deleteButton;

            },
        },

        // Add other columns as needed
    ],
    language: {
        paginate: {
            first: 'First',
            last: 'Last',
            next: '&rarr;',
            previous: '&larr;',
        },
        lengthMenu: 'Show <select>' +
            '<option value="1" selected>1</option>' +
            '<option value="2">2</option>' +
            '<option value="3">4</option>' +
            '<option value="4">6</option>' +
            '<option value="-1">All</option>' +
            '</select> records',
                /* "oLanguage": {
            "sLengthMenu": "Display _MENU_ records per page",
            // other language options
        },*/

        info: 'Showing _START_ to _END_ of _TOTAL_ records',
        infoFiltered: '(filtered from _MAX_ total records)',
        
    },
});

$.ajaxSetup({
    headers: {
        'X-CSRF-TOKEN': $('meta[name="csrf-token"]').attr('content')
    }
});

$('#postForm').on('submit', function (event) {
            
    event.preventDefault();
        if($(this).valid()){
        var submitButton = $(this).find('[type="submit"]');
            submitButton.prop('disabled', true).text('Please wait...');

            var post_id = $("#post_id").val();
            var is_published = $("#is_published").val();
            var is_post_image = $("#is_post_image").val();
            var title = $("#post-title").val();
            var body = CKEDITOR.instances["post-body"].getData();//$("#post-body").val();
            var excerpts = $("#post-excerpts").val();
            var author = $("#post-author").val();
            var image = $("#post-image")[0].files[0];
            var meta_tag = $("#post-meta-tag").val();
            var meta_desc = $("#post-meta-desc").val();
            var keywords = $("#post-keywords").val();
            var url =$(this).attr('action');
            if(typeof image == 'undefined'){
                image = '';
            }
            var form = new FormData();
            form.append('post_id', post_id);
            form.append('is_published', is_published);
            form.append('is_post_image', is_post_image);
            form.append('title', title);
            form.append('body', body);
            form.append('image', image);
            form.append('author', author);
            form.append('excerpts', excerpts);
            form.append('meta_tag', meta_tag);
            form.append('meta_description', meta_desc);
            form.append('keywords', keywords);
            

            $.ajax({
                type : 'POST',
                url : url,
                headers: {
                    'X-CSRF-TOKEN' : $('input[name="_token"]').val()
                },
                data : form,
                cache: false,
                contentType: false,
                processData: false,
                dataType: 'json',
                success: function(data){
                    submitButton.prop('disabled', false).text('Submit');
                    post.ajax.reload();
                    $('.modal').modal('hide');
                    $('#postForm')[0].reset();
                },
                error: function() {
                   
                }
            });
         
            /*url =$(this).attr('action');
            runajax(url, formData, 'post', '', 'application/json', function(output) {
                    // var output = JSON.parse(res);
                    submitButton.prop('disabled', false).text('Submit');
                    post.ajax.reload();
                    $('.modal').modal('hide');
                    $('#postForm')[0].reset();
            
            })*/
        }
});

function actionmethod()
{
    actionsurl = $('#seturl').val();

    runajax(actionsurl, '', 'get', '', 'json', function(output) {
            
            console.log(output);
            if (output.success) 
            {
                $('.modal').modal('hide');
                post.ajax.reload();

            }else{
                       
            }
        }); 
}

function seturl(url)
{
    $('#seturl').val(url);

}

</script>
@endsection

