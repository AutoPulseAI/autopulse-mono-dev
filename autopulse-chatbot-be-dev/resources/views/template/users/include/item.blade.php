<?php  for ($x = 0; $x < 10; $x++) {
     if(!isset($latest_car['listings'][$x]))
     {
        continue;
     }
   $item = $latest_car['listings'][$x] ;
     if(!isset($latest_car['listings'][$x]['media']['photo_links'][0]))
     {
        continue;
     }
    
    ?>

    <div class="item">
         @include('template.users.include.vehicle_item',['class'=>'','item'=>$item])
       
    </div>
<?php  } ?>