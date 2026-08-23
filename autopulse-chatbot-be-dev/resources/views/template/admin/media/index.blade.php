@extends('layouts.admin')
@section('content')
<input type="hidden" id="seturl" value="">
<!-- Page Content Start -->
<div class="admin_inner_content bg-white">
    <div class="row">
        <div class="page_title d-flex align-items-center">
            <h2 class="mb-0">Media</h2>
            <div class="page_title_btn ms-auto">
                <button class="btn btn_theme" id="createMedia">Add Media</button>
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
                <table class="table table-bordered w-100 dataTable" id="media_tabl">
                    <thead>
                        <tr>
                            <td>#</td>
                            <td>Title</td>
                            <td>Slug</td>
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
<div class="modal fade" id="mediaModal" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-lg">
        <div class="modal-content">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 id="mediaHeading" class="modal-title"></h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body">
                    <form action="{{ route('media.store') }}" id="mediaForm" method="post" enctype="multipart/form-data">
                        <input type="hidden" name="media_id" id="media_id" >
                        <input type="hidden" name="is_published" id="is_published">
                        <input type="hidden" name="is_media_file" id="is_media_file">
                        @csrf
                        <div class="row">
                           
                            <div class="col col-12">
                                <div class="mb-3">
                                    <label class="form-label">Title</label>
                                    <input type="text" id="media-title" class="form-control required"  name="title">
                                </div>
                                <div class="mb-3">
                                    <label class="form-label">Media URL</label>
                                    <input type="text" id="media-url" class="form-control"  name="mediaurl" cols="2" rows="2">
                                </div>
                                <div class="mb-3">
                                
                                    <label class="form-label">File</label>
                                    <input type="file" id="media-file" class="form-control"  name="file">
                                </div>
                            </div>
                            <div class="col col-12 text-center">
                                <div class="mb-3">
                                    <label class="form-label"></label>
                                    <div id="view-media-file"></div>
                                    <div id="file-info-msg" class="pt-1"></div>
                                </div>
                            </div>
                            <div class="col col-12">
                                
                            </div>
                            <!--div class="col col-lg-12 col-md-12 col-12">
                                <div class="mb-3">
                                    <label class="form-label">Content</label>
                                    <textarea type="text" id="media-content" class="form-control"  name="content" rows="20"></textarea>
                                </div>
                            </div-->
                        </div>
                        
                        <div class="row">
                            <div class="col col-12 text-center">
                                <button type="submit" id="mediasubmit" class="btn btn_theme" value="create">Submit</button>
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
                <h5 class="mb-4">Are you sure? You want to publish media?</h5>
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
                <h5 class="mb-4">Are you sure? You want to draft media?</h5>
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
                    <button  type="button" class="btn btn_theme" onclick="actionmethod()">Yes</a>
                    <button type="button" class="btn btn_dark ms-2" data-bs-dismiss="modal" aria-label="Close">Cancel</button>
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
    /*CKEDITOR.replace('media-content', {
        filebrowserUploadUrl: "{{route('media.upload', ['_token' => csrf_token() ])}}",
        filebrowserUploadMethod: 'form',
        format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'
    });*/
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
var media ='';
var myurl = '{{route('media.tableData')}}';
$(function () {

    $('#createMedia').click(function () {
        $('#mediasubmit').val("create-media");
        $('#media_id').val('');
        $('#is_published').val('');
        $('#is_media_file').val('');
        $("#file-info-msg").empty();
        $("#view-media-file").empty();
        //$("#file-info-msg").html(`<i class="fa fa-info-circle"></i> Default Image`);
        //CKEDITOR.instances["media-content"].setData('');
        //$("#view-media-file").html(`<img src="{{asset('assets/images/active.png')}}" width="300" height="200" class="object-fit-fill border rounded">`);
        $('#mediaForm').trigger("reset");
        $('#mediaHeading').html("Create Media");
        $('#mediaModal').modal('show');
    });

    $('body').on('click', '.editMedia', function () {
        var media_id = $(this).data('id');
        $.get("{{ route('media.index') }}" +'/' + media_id +'/edit', function (data) {
            $('#mediaHeading').html("Edit Media");
            $('#mediasubmit').val("edit-media");
            $('#mediaModal').modal('show');
            $('#mediaForm').trigger("reset");
            $('#media_id').val(data.id);
            $('#is_published').val(data.is_published);
            $('#media-title').val(data.title);
            //$('#post-body').val(data.body);
            //CKEDITOR.instances["media-content"].setData(data.content);
            if (data.file) {
                $("#file-info-msg").html(`<i class="fa fa-info-circle"></i> Featured Image`);
                $("#view-media-file").html(`<img src="`+data.file+`" width="300" height="200" class="object-fit-fill border rounded">`);
            }else{
               // $("#file-info-msg").html(`<i class="fa fa-info-circle"></i> Default Image`);
                //$("#view-media-file").html(`<img src="{{asset('assets/images/active.png')}}" width="300" height="200" class="object-fit-fill border rounded">`);  
            }
            $("#is_media_file").val(data.file);
            $('#media-url').val(data.mediaurl);
        });
    });

});

media= $('#media_tabl').DataTable({
    processing: true,
    serverSide: true,
    ajax: {
        url:   '{{route('media.tableData')}}?source=media',
        type: 'GET',
    },
    columns: [
        { data: 'id', name: 'id' },
        { data: 'title', name: 'title' },
        { data: 'slug', name: 'slug' },
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
               
                viewurl = `{{ route('media_list') }}/`+row.slug;
                publishedurl = `{{ route('media.publish') }}`+'?media_id='+row.id
                draftedurl = `{{ route('media.draft') }}`+'?media_id='+row.id;
                deleteurl = `{{ route('media.delete') }}`+'?media_id='+row.id;

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

                var editButton = `<button class="btn btn_theme btn-sm editMedia" data-id="`+row.id+`">Edit</button>`;

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

$('#mediaForm').on('submit', function (event) {
            
    event.preventDefault();
        if($(this).valid()){
        var submitButton = $(this).find('[type="submit"]');
            submitButton.prop('disabled', true).text('Please wait...');

            var media_id = $("#media_id").val();
            var is_published = $("#is_published").val();
            var is_media_file = $("#is_media_file").val();
            var title = $("#media-title").val();
            //var content = CKEDITOR.instances["media-content"].getData();//$("#post-body").val();
            var mediaurl = $("#media-url").val();
            var file = $("#media-file")[0].files[0];
            var url =$(this).attr('action');
            if(typeof file == 'undefined'){
                file = '';
            }
            var form = new FormData();
            form.append('media_id', media_id);
            form.append('is_published', is_published);
            form.append('is_media_file', is_media_file);
            form.append('title', title);
            //form.append('content', content);
            form.append('file', file);
            form.append('mediaurl', mediaurl);

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
                    media.ajax.reload();
                    $('.modal').modal('hide');
                    $('#mediaForm')[0].reset();
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
                media.ajax.reload();

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

