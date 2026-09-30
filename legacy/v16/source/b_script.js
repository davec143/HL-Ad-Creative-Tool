
(function(){
  var HF="Higgsfield", SH="Shopify";
  var mcp=null, sample=null, dl=null, picked=null, busy=false;
  var haveHF=false, haveSH=false;
  var DASH="\u2014";
  var $=function(id){return document.getElementById(id)};
  var logEl=$("log"), outEl=$("out");

  function log(msg, cls){
    var s=document.createElement("span");
    s.className=cls||"s-run"; s.textContent=msg+"\n";
    if(logEl.dataset.fresh!=="1"){logEl.textContent="";logEl.dataset.fresh="1";}
    logEl.appendChild(s); logEl.scrollTop=logEl.scrollHeight;
  }
  function fail(title, body){
    var d=document.createElement("div"); d.className="err";
    var b=document.createElement("b"); b.textContent=title; d.appendChild(b);
    d.appendChild(document.createTextNode(body)); outEl.appendChild(d);
  }
  function explain(e){
    var c=(e&&e.code)||"upstream_error", s=(e&&e.server)||"the connector";
    if(c==="needs_reauth") return ["Reconnect "+s, "Its access has lapsed. Reconnect it in claude.ai → Settings → Connectors, then try again."];
    if(c==="server_not_connected") return ["Add "+s, "This page needs the "+s+" connector. Add it in claude.ai → Settings → Connectors."];
    if(c==="not_in_manifest") return [s+" isn't allowed here", "The connector was turned off for this page, or declined. Reload and allow it to continue."];
    if(c==="selection_required") return ["Choose a "+s+" connection", "You have more than one. Pick one when prompted, then try again."];
    if(c==="blocked_by_policy"||c==="approval_required") return ["Blocked by policy", "Your organisation restricts this tool on "+s+". An admin can change that."];
    if(c==="server_unavailable") return [s+" didn't answer", "Usually temporary. Wait a moment and run it again."];
    if(c==="rate_limited") return ["Too many requests", "Wait a short while before running it again."];
    if(c==="tool_error") return [s+" reported a problem", (e&&e.message)||"No detail given. Check your Higgsfield credit balance and the image URL."];
    if(c==="not_granted"||c==="capability_disabled"||c==="capability_removed") return ["Connectors unavailable here", "This view can't reach connectors. Open the page in claude.ai."];
    if(c==="cancelled") return ["Cancelled", "The request was stopped before it finished."];
    return ["Couldn't reach "+s, (e&&e.message)||"Unknown error."];
  }

  // ---------- tabs ----------
  function tab(which){
    var s=which==="shop";
    $("tab-shop").setAttribute("aria-selected",String(s));
    $("tab-url").setAttribute("aria-selected",String(!s));
    $("pane-shop").hidden=!s; $("pane-url").hidden=s;
  }
  $("tab-shop").addEventListener("click",function(){tab("shop")});
  $("tab-url").addEventListener("click",function(){tab("url")});

  // ---------- shopify search ----------
  function setPicked(p){
    picked=p; var el=$("picked"); el.hidden=false;
    el.innerHTML="";
    var b=document.createElement("b"); b.textContent="Using: ";
    el.appendChild(b); el.appendChild(document.createTextNode(p.label));
    if(p.outOfStock){
      var w=document.createElement("div");
      w.style.marginTop="6px"; w.style.color="var(--stop)";
      w.textContent="Zero inventory in Shopify — point the ad at an in-stock SKU before you spend on it.";
      el.appendChild(w);
    }
  }
  $("search").addEventListener("click", function(){
    var q=$("q").value.trim(); if(!q) return;
    var r=$("results"); r.innerHTML="";
    if(!mcp){ fail("Shopify catalog search is not available","This view has no connector access, so the catalog can't be searched from here. Use the Paste an image URL tab instead."); return; }
    // Shopify's connector ignores plain free text and returns the catalog in ID order,
    // so search by title words (all must match) or by SKU for a single token.
    var terms=q.replace(/["'()*:\\]/g," ").split(/\s+/).filter(Boolean);
    if(!terms.length) return;
    var sq="("+terms.map(function(t){return "title:*"+t+"*"}).join(" AND ")+")";
    if(terms.length===1) sq="("+sq+" OR sku:*"+terms[0]+"*)";
    sq="status:active AND "+sq;   // archived and draft listings can't take ad traffic
    log("Searching the catalog for “"+q+"”…");
    mcp.callTool(SH,"search_products",{search_query:sq,first:8},{cache:{staleTime:60000}}).then(function(res){
      var p=res&&res.payload, edges=[];
      try{ edges=p.data.products.edges||[]; }catch(e){ edges=[]; }
      if(!edges.length){ log("No products matched.","s-err"); return; }
      log("Found "+edges.length+" product"+(edges.length===1?"":"s")+".","s-ok");
      edges.forEach(function(e){
        var n=e.node||{}, url="";
        try{ url=n.featuredMedia.preview.image.url; }catch(err){ url=""; }
        var inv=typeof n.totalInventory==="number"?n.totalInventory:null;
        var sku=""; try{ sku=n.variants.edges[0].node.sku||""; }catch(err){}
        var btn=document.createElement("button");
        btn.className="prod"; btn.type="button"; btn.setAttribute("aria-pressed","false");
        if(!url) btn.disabled=true;
        var left=document.createElement("span");
        var t=document.createElement("b"); t.textContent=n.title||"Untitled"; left.appendChild(t);
        var m=document.createElement("span"); m.className="m";
        m.textContent=(sku?sku+"  ·  ":"")+(url?"image on file":"no image on file");
        left.appendChild(m); btn.appendChild(left);
        if(inv!==null){
          var s=document.createElement("span");
          s.className="stk "+(inv>0?"in":"out");
          s.textContent=inv>0?inv+" in stock":"0 in stock";
          btn.appendChild(s);
        }
        btn.addEventListener("click",function(){
          Array.prototype.forEach.call(r.children,function(c){c.setAttribute("aria-pressed","false")});
          btn.setAttribute("aria-pressed","true");
          setPicked({url:url,label:n.title||"Selected product",outOfStock:inv===0,title:n.title||"",desc:n.description||""});
        });
        r.appendChild(btn);
      });
    }, function(e){ var x=explain(e); log(x[0]+" — "+x[1],"s-err"); fail(x[0],x[1]); });
  });
  function pickUrl(){
    var v=$("imgurl").value.trim(), nm=$("imgname").value.trim();
    if(/^https:\/\//i.test(v)) setPicked({url:v,label:nm||v,outOfStock:false,title:nm,desc:""});
  }
  $("imgurl").addEventListener("change",pickUrl);
  $("imgname").addEventListener("change",function(){ if(picked && picked.url===$("imgurl").value.trim()) pickUrl(); });

  // ---------- the real HitLights logo ----------
  // The generator never draws the logo: it leaves the reserved space empty and the real
  // artwork is composited onto each finished image. Never recolour, redraw or restretch them.
  //   These 600x84 copies are for on-page display, the Brand kit and its download only. Finishing
  //   uses the full-size official lockups from the HitLights Shopify CDN (LOGO_URL, 1179x166).
  //   white, black: the official lockups, both carry the ®.
  //   violet: the black lockup's exact shape in logo violet #55426A (the Full-Logo-Purple colour),
  //           built the same way in the sandbox. Used on the Template 2 bubble.
  var LOGO={
    white:"iVBORw0KGgoAAAANSUhEUgAAAlgAAABUCAYAAABeO0mOAAAVuElEQVR42u2de5BkVX3HP7e7Z2Z3WHB5ui6GIC8JKDEKIiaoBBVJUsnyiAEU0agVC9TEgEkqKImUYkRIKUaJSIIIhVFMhYhgImiEsngENZFnAEERVl7CssAsOzvdffPH7xz6Ms5039tzH+fe+X6quna25073ueee8zvf8zu/8ztRHMdUyCSwDbAOeBGwBjgM2MH9LqI+zAETwKnAGe7nOYQQQghRV1pAH9gJOBk4BFjt9EkXWA98FThv3vV0KipwxxX0BCeqttUzFEIIIURAtIEe8AfAWcAPgY8DtwCbge2AA4BjgeOAPwbudeIrLltgRUCMeafOcEoP917P/b5FvTxXQgghhGgWLadL3gJ8GnMIXTHvmgeAm4F/Aj4CfBs41ImsVlUerBh4BHO5+Rvp6HkKIYQQIgBxFQP7YJ6rI4FrsXCmdcAKbBnwTuAS4G7gb5wguxh4HTDXqvAGOshbJYQQQojwiJ1o+pITV23gNzFPVgdbiXsH5rXaxemZ07G4rGOAuKU6FEIIIYQAzOnTB9YC+2LB6365cA64CTjavV4KbA/8jvubCPgicBQMYqCWUhCJNCGEEEI0Aa9p9gE2Aj/luStt2wB7A3sAbwCmgSfc72Lgv7HNeys7SyxE332gEEIIIURT2BqYwTxXE+7fWWAv4EpgpRNS/wBcxmAT3xPYcuLUuN6nthNXHeBC4I2J94UQQggh6swzTkT5JUOwuKt7sSD2E5wA+yKWssHrn63c9VvGEVg+L8Rap+Le5r4UFLAuhBBCiPriV+XuxnJ0viAhsCInqn4GfAuLx/pw4m8j4DcwL9amrALLi6t93Ye/wf1fy4RCCCGEqDt9LATqHuDnWBLR2L23AovBmnL/Pw9LQvrrDEKmjgP+A7LlnvLi6lXA14EdMbfYCj0PIYQQQjSMjwH/gsVY3eN+/i62mzB2Wuh4J6762Irenu69KK3AWkhcdVFyUCGEEEI0C+/FugY4F/gv4E3YDsEkM1hiUbCM73+PJSLdSMpM7sllwcuxg5h7Tlx19RxyI8tybUxYy7IR2eLv+hXUSavhxqCpbavItljkvWbtE2WS5r6L6tN1tachP8+i7UfR9R9qf+g7/XM65rG6CrgI+DJwF7ajcBUWc/Vu4EDgzcD33P33OykqqYd5rL6WEFfaLViPRh6Swa66TvpqW8uCqgSiP5UiTtR5rHpsTJuve32U2f7jBtkcf0byx4Grgb/Adg3GmIPJO6CuAQ4CfpF4b+gSn1fsK7H1x73RsmCRs+7dGJxvFA3p5BPA/cCGeQa9qnLHWCbbnZ3KH1b2Frb19Scpyt0Cdsd2qI6qkw7wEPDoAnXi//+rWF6TXsNmojG2bXh2kd9PYjEBcYrPaWG7Y54KoG2Na+TXuPYQjxh8VwCPMUgQuNSBpTfv/dXY8RlzAbU331c2YIfULvSM/XurgF1T9pc+tuOqF1Bb2A1LANkbYTvarh08OOLz1jAIjWma/bgH2LKEMaC1wLPfPcV4FsK9t914unGIzfPX3QT8oWsHL3S29WlXf5sT9uDZuuiMMBw94Bzg1RJXhQ0IfTf4X4NtCR3WIOdco30/8AX30Ktcpu24Mr0F+IRrZBMjBvCHgd/Cdme0Fpjp+Pd2Am5w9ztssOy6hn4BcFKiTPPb8eeAQ9zvmuKB9fVyCPD95MwpUY+7YnEDowydX/b/CHBmAG1rnH60xt3r1CL3G7l7mnZG9fecYWVMMZms718BXoPtIFrjJh3PD2xA7rq6uQzbGbXQM/b95QTgkyP6S3LStBfweECTvi9jx5h0WXy5yudyvA54/Yiyfx7bNd8k++Gf4RHOO9POKJJ9v+s5O3O4a/+r3Jg2FfgkzScQ/SR25uAwm9dLtKNH3Wu+LejPH886IwzHscC7XKOakB4qjEk3451OMVNsBfgsJp0QmmT02vu2DPKmjRq8tk05e265Tj2Macwbu7KB7WdihBGcTvEZvh63qXk97JziugeAt2NHYCwk8tMM4t5rtQdwihukdgq8fvwzTtMHtnbXrUjRBzsBeim2ytDXt0txzeoG24/pMf7Ga4TVwIdcf9q+Zvft+8PzMlyf7P9JkdpbrGMspkrXYhHxfRRzVcYsostg/ToaMgOdCHBWECfuYZgHK0rcZ9o6GeU17bHwEs1C1/mO0JT27A1EnPL5RCnqsVvzfjTrBHyc8EhEibZ5O3byxHonJp/M+B3JI8JOdoPL6kT/jBYxwqHM2NP0lbT9Jc7weVXca5zoI8P6T5o2322g/Rj3+XlxdQBwPrDfAu2/DkHu49q81PF4nUVmZ33gM5irW0Ht5RDNM86jrgm1/FHKe8xaJ0v53vnXRQ1sM6OuI+WzqXvdtBYQOV5c3YFttV6PhT486QRS2qURL66msCPC/ihhqFuEH0IRZWwzRfTpKu41KrE+mmpD5ourQ7CsAlthK1wd6hdCVPjzbC1SeeuAIxlEyQshRB3xXlDvubofSx74PieURgnPpDGO3d9c6sSVTzbYRseEiebj4/P2Af7ViSsfx6T2vwCdBQzINPB3GQyPEEKELK5uAw7DPFdnAh90A0PapYEoMRn9GhYcr7hUsZxIZhW4AIuP1ca3FIo0+XMfeCfwYuS9EkLUF78r8vsJcXWWE1ezzraljRPxM/ePSVyJZawVesDfAq+UuEpHJ6FOe9jOkVMYbL8NgXGSliXjMIQQy1NcXY2FO8w4cXUyw7ftL4QPmzgw8fcaWMRywqcg2BtLEaS47IwCy+d/OA5LjheSEYn0MIUQKeliyxhXOXE1C/wj8CeJgSHrrqkpLM9bh+YlqhUiDbETVyvUB7ILLG94TmT0du4yH2iEZR3+SQYxFmNZVncK6F6EEMXTd+Lq6oS4+gpw1JiTRi/GXgm8FqWsEcsPv7q1M3bOXkirW7UQWP7Q5kOxfBahGBFfjiuBt2b827OBP2d4XiaxvPBBzT4/Tl7Gp52xDHHOfaSFzkjz+Czlb8VOFbiUwW7opXjk30m2s+h8WENoz6WbaIcie1/rFtCHOxnLkOcZf8lcccMmGV0s59X2GfpS3mUtsj8U1k+TZ3YdM89ohyQCWwkhOIwJFIAqFmY11edqaRfYR5b74AeWof1IN2gsVVz5fICrgINJny8nJtywBl8Pz5M5yMyqAOxHq6CxuT2iPYPlvYoz9IGiylpEf5gq8gt8cPu6ggeBpajsfkpF3Kf+p9iLYgbfU7Cz4fKIH/A7bncHznB9Zpjx8UvwZwPXM14c0LCy3D7vXpcjEbYkOIEtCx7B0jxXftfUftg5e2kmnr4NbHRluJpsnq8ybGnbCVGQJysLH8BCT/K0HztiZ6SO+jxvPy7HEtzmaT8iZ5MWsx/+TM/DUk4yfB+4CjgvMVEJEd8fbi2qP3jjcziDg4a1viqahB/cri3gs/cEPppiUuLL8B1sybvoe12O4gos8eFXgN8l/406aY8jWo8dHHxnjfqGGM31BXzmaiew0j6nm7EEn2W3hzil+PD64X43wZmp6ViRq8CKgIPmVZAQTSPPbNt+Brptxr/bhufGPeZFj+U9WPpZ8vOduOrnKK4OyPAMOtj5rXdi5yGGutsq7YApirUf22X8u+mS7cf8TWOMqAP/GT9w4irEc3MXE4aFeNk6ruGsSzQiIZpIngOKN5C9McrgDWNXj6QQ4ZD3JHHXlN/bATYB32BwgHBfj0T2I0f70S/ZfniBtTblZNKLqW8lJj3LWsi3sO2X26v/CCEaYtPyZEuGa58C7kVxoKJZRBX3wdrSwdZKt0bLg3UbRNoMgquroq12IzS4POfazhJm7e2S7qeIJRFvj0Zt+y/j/pT/MB/8c3wAy0e5w4i69e+/EfhsxeNCMri+so0mHQZbdjVQ1ocZZ8Srdr/679+kRyLEcwalpfSnOrIhsPJrCT6fthxhGzcedQIrjbh9ift5LqB7mXDts9Rl+w7w0jFmaqIavAD+bddYpio2am1sa/zB88onhEg/046xI0h+H1tNKCo4PsaC73+M7WhdqrcpStiB92BLpFUnvvWeix00ruVap2nq0ceW7QZcAXzdjQ9VCMMp4EfAz4AnEk4Av+pSShvtAK9JfLEIG/+MjnevUMsnhMgmsHYBLqacJMlXOoHls3Tn4R04J+D6FUsXrDcBL04hTPwk+3D3qpoutqv3CuAiBjmvvBgsXGCtVhuqHSElL8wywxFCLM4MlsqjqBginxtscwGfHdqOSXnT86vHvhPlx2cYd0JIUeJPgNnXvf4Myzt2KubRyjNh66ICq6M2VMtZhQSNEM0bzFoFCiz/+UV9tmgeXoBcj8XZrU7ZPkNazfCbOiadyHodcAKWuLVQkVVUZ0v74LopXsolI4QQQpSPP1fwPmyZLaJ+mzG8Jwss8P5lwDexY7B6RU4Oqpx1rHY3PcHAk5Z8Tbl/V6qNCyGEEJURAWdiy8tVp+JYChOY42atE1lrKTCDQifHyk+rhsGS952IZYftDbl2ErjR/V+eLCGEEKJc+thS2i3A+cB7MU/QRE3vp5MQWRcyOMg6WIGVlR7wz2M8ZCGEEEKUL7JawGlYItG93Dhe153jXmS9Hgvev5AC4rFaFd9gmpeCJ4UQQojq8KtPG7CzizdQwi68gvEbSk7HDtLOfedjleKli4LchRBCiDrglwrvwHJcPcogl1odY7K8wNoFOLoITSTvUHFKv4zvCeUlhMjPdtS1D8omNR+/LHgj8FosLqvDYHdht2bP32d1fzMD71VuXiwJrPwp6wysKKCXEGLp/bmdsMt17IOySctLZN0BHAScgR1H006IrRCef5rVL39A+SHAGnJeJlSS0fzwYvXJEjxZpR9ameLedUyOEOOzBcsuvXJMI9+pWFjMBVafVdfHchBZLez0gVOBzwDHAK8ADgW2r7j+J0jnQPIpJ6axwP0H826EIj+RsRnLeJtWPWfFH3XxIWzXg98JUWUjnsMOej0tUT4hRDq8nbgPS3zYzjA584NDhB2s+woKzOmzAP67Z4GXY4HPVedI8t//beDXSq6P5dh2I1e/DwGfcu9vix1eXtXzj4AdsbMHX5KiDfjYssOBa8jxnEINhvkamhng9sR7RXwPwGN5K+0l8niB9yzEchmsHl7C389WbP/uB54KqD7n1KRKe/be4+onBxsCKNd64N3AdYz2pPlx6wV5F0ICK1+B9SDluEUn3PeE4sGaUBMQ4tkZ9FJn3+N4sKpeDpsCniYcD5aWB8sfA7s59IE8+9+dmNNjVco2kbunUwIrH/x69OVOcBSdHySUHTPatSOWw8CR1RYstT8VWb6ibUEIZZI9Wr71HydEdgvz7K6qqjBVrk03aUeIr8d7AlDwQoj8mMxg2LcD9nf2QHE/QlRPpWNxlR6suITPL8u74ndTfDOHWawQVRukVmAiocods/+Xss78Bo+jgBso5xSKkJYIxfKgVZMy9l2fnK5Sk5QtsLxBWAF8B9ttsNjaqM+1cSVwMtmW3Xxui8kS7+1/gZ9T75PGhZh1xmmLqgKAWzPYnBh4P3A3cF7J5ezqUYmGT3aylvEDTmukPTMxd5tXlQcrwrYkb5Xi2tsTf5PWyHwUOJfBNtIi8Wu9DxelgoUocWZ6NLCrm5xUbUxjZ6NOA35KjtunM7DJGd5RGzm8nZkEPg+cBNyF5cUrw5O1VwY7KcQ4bSwG/hrYG4s1bgVazjnghcCb5tm2Ufd2Y95jeJVLhDNYUr1RHqws2499xTzkXkKIbALrZe4VEp91AqtM8eA3rtwM/BB4VcqZsLdB+7lXFQOMEEUJrHcAe9Sw7MPwffqaJgksH+OxmMDynqFozAot29BoN51oAv2A2rFPEFjV8pc/X+06J7CyGPOy63FcWylEFjYyOEkk9HisNH3C38c9wCPkHOLT1DQNEjtCjG+UQpp5VikcvA35AvBeZy/T5ljSLkLRRNoMYpyb0MZ9H/8Gdp5irrklZQSEEGLx2W0b20l4MdXEgAkhip1Q9oHzE32+kbNVIYQIcYbbAk7HlkcksoRoBv6In68Ct2HeKwksIYQoCb8T+T7gRPdzSHFqQojxJk5gu4Q/7P6f+8RJAksIIUbPdDvAJcAn3M89iSwhaksXW/4/Bfix+1kCSwghKhJZbeCvgLOcyPK7DIUQ9SDG8mRNYOlfznU/F7LsL4ElhBDpDLPf0v1BLEv0rBNdXeTREiL0/utjriawZMDvY5AGppC+m1eahhaD7ZvDCupzTLQzfHaU8rPLNLJFzZC9kY6GXNMK0JDHifK3hlwTZay/HqO3xPfG+Ny877uV4rlVeYTSqHYVKj7WKc54r2nbVTzG8/ZB75/Czhw8BzggcU034HrO0leSfZoRfboXaNvpMTxerl+wTW+CjRunXkMUVx2nIZ7ENqycnbDbhd1HXgJrU4rOmOTpDDc1l/Gz60gL2CaF8PS/nwys/JMJETyKrUnnOY2AqRTX+e+cruC+O9hZV2nLOFFR22rXtF+05/2b1736a1aMWa6+e/Y3AK8GjgXeAxxI2LkFs/SVqQx9eqsAReWqFOVvJ66tgihle/HlXFmTeg2RJ4D/xI7duotBzFWhIrGTQwMB2Bd4nNFJupKHPac922tH4OXknAAs4z36nUSz2HbOvHkS+C52+PWwGU3XiZn1CWVe9cwA4H7sOJEtQ9qUH5QeAZ4aUn7/3iyWQXuK4WdK+jq5tYI6eQz4njN8acr4aAVl3OSeTZqZcoheiM6I9pJkBjtPrM1oj+IEg3NOx3keXQbLCxe51/7AnsAR2HmOodW3b4e3peh/d7t202W4V7oFbHYT4ZC4CUurMaz8vh38oKIyPuNE+sQI++HLeVsAdv8G5yCZq4HIirHdv5cC/+PatBespThsojiOFTeQnrc5Q6pcOEIIPwHzSw2yCUKES7vsfpqXO3ucdcxWgZ+dpwLuYl6UPy1YXLUKru+iB5kss/V+g+qkaWUMkX7AzyNOzIbbAXgY8rrvovp0qG2+X4NyhmD362hLonn9tLwvlgdrpOHsAGcAp1LdMqUQQggh6qTsJLBGiqvPASeh5IJCCCGESInyYC0srnxw7TlOXLUkroQQQgghgTUeyViKv8TirgrPlSGEEEKIZtFRFTxLl0GM1buACyWuhBBCCDEO8mDZcqBfEvwRcLATVx3qla1WCCGEEBJYleNTMLTc60Inrm5gcL6YEEIIIYQEVgZh5Y8puAtYB7wdyxhdWpZXIYQQQkhgNU1YPYMd+Lg/8O9OWIV6cKkQQgghakTT82Al0+L7LMuzwCXAWQzOIpPXSgghhBASWEMEFQyC05O7JB8DvgRcANySEFYKZBdCCCGEBNY8/C7AiF8+3XsGuA74N+xE7V+491uJvxVCCCGEkMAawmZgI3A1thvwMuCBxO9LP01bCCGEEMuPOica7WEeqpuBa4FNwJXYrsCZBe6zh+KshBBCCFEC/w8Bdw8WoFsZwAAAAABJRU5ErkJggg==",
    black:"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",
    violet:"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"
  };
  // ---------- LOGO GRID (rev. Sept 25, 2026) ----------
  // One fixed position per template and canvas; the Brand kit card at the bottom of this page
  // renders from this same table, and its download is the vault's HitLights Ad Templates.html.
  // Pixel coordinates are the logo's top-left corner on the FINISHED canvas. finish.py places the
  // logo exactly there - it never searches for space, never changes corner, never snaps sideways.
  // The layout prompt keeps that zone clear instead. Only Template 2 is content-aware: the logo
  // centres in the top of the white bubble the generator drew.
  var CANVAS={master:{W:1080,H:1080,w:280,dims:"1080x1080",title:"Square"}, portrait:{W:1080,H:1920,w:320,dims:"1080x1920",title:"Portrait"}, landscape:{W:1200,H:628,w:240,dims:"1200x628",title:"Landscape"}};
  var KINDS=["master","portrait","landscape"];
  var TL={master:[64,64], portrait:[64,288], landscape:[56,48]};
  var LOGOGRID={
    t1:{colour:"white",  shadow:false, ground:"panel",  even:true,  a:"tl", pos:TL, sits:"Violet field"},
    t2:{colour:"violet", shadow:false, ground:"bubble", even:true,  a:"bubble", pos:{master:[400,88], portrait:[380,309], landscape:[216,72]},
        pad:{master:40, portrait:40, landscape:28}, bx:{master:[.06,.94], portrait:[.06,.94], landscape:[.02,.56]}, sits:"White bubble"},
    t3:{colour:"white",  shadow:false, ground:"panel",  even:false, a:"tl", pos:TL, sits:"Dark gradient", grad:["241A30","120C18"]},
    t4:{colour:"white",  shadow:true,  ground:"photo",  even:false, a:"tl", pos:TL, sits:"Photo (calm corner)"},
    t5:{colour:"white",  shadow:true,  ground:"photo",  even:false, a:{master:"tc", portrait:"tc", landscape:"tr"}, pos:{master:[400,64], portrait:[380,288], landscape:[904,48]}, sits:"Photo (dark ceiling)"}
  };
  var SAFE_TOP=269;     // 9:16 - top 14% is covered by the Stories/Reels header
  var LOGO_AR=166/1179; // height/width of the official lockup files
  // Brand field colour each template's flat panel must land on exactly (the generator drifts
  // it a few shades per render); "-" where the ground is photography or a gradient.
  var FIELD={t1:"523875", t2:"-", t3:"-", t4:"FBF6EE", t5:"-"};
  // Runs in the Higgsfield sandbox. finish.py locks the brand panel colour, finds the gold CTA and
  // pulls it onto #EBA800, places the real logo at the grid position, and FLAGS rather than moves:
  // PLACEHOLDER (blank shape where the logo goes - repainted once), COLLISION (artwork inside the
  // logo zone), CONTRAST (fixed lockup illegible, other one used), BUBBLE? (T2 bubble not found),
  // SAFEZONE (9:16 logo in the top 14%), NOCTA / CTACOLOR (gold button missing / far off palette),
  // FIELDCOLOR (brand ground off palette).
  // finish.py and the lockup builder, as readable source; written into the sandbox by heredoc.
  var LOGO_URL={"white": "https://cdn.shopify.com/s/files/1/2097/6403/files/Logo_White_HitLights_R.png?v=1614820672", "black": "https://cdn.shopify.com/s/files/1/2097/6403/files/Logo_Black_HitLights_Rs_1e65dd71-06e3-4435-aca2-1728dd559b58.png?v=1614820450"};
  var FINISH_SRC="import sys, os, json\nimport numpy as np\nfrom PIL import Image, ImageFilter, ImageDraw\n# HitLights finishing v3 - places the real logo on the Logo Grid and checks brand colour.\n#   python3 finish.py <render-at-exact-size> <out.jpg> '<spec json>'\n# Lockups (logo-white.png, logo-black.png, logo-violet.png) sit next to this script: the official\n# HitLights lockups from the Shopify CDN (white, black) and the black lockup in logo violet #55426A.\n# The logo always lands on the exact grid position for the template and canvas: it never\n# searches, never changes corner, never snaps sideways. Template 2 is the one content-aware\n# case: the logo centres in the top of the white speech bubble the generator drew.\n# Problems are FLAGGED, never \"fixed\" by moving the logo:\n#   PLACEHOLDER blank patch painted where the logo goes (the page repaints it once)\n#   COLLISION   artwork inside the logo zone          CONTRAST  fixed lockup illegible, other used\n#   BUBBLE?     T2 bubble not found                    SAFEZONE  9:16 logo in the top 14%\n#   NOCTA       no gold CTA found                      CTACOLOR  CTA too far off #EBA800 to correct\n#   FIELDCOLOR  brand field / ground off-palette\nimg_p, out = sys.argv[1], sys.argv[2]\nspec = json.loads(sys.argv[3])\nhere = os.path.dirname(os.path.abspath(__file__))\nLOGOS = {k: os.path.join(here, \"logo-%s.png\" % k) for k in (\"white\", \"black\", \"violet\")}\n\nim = Image.open(img_p).convert(\"RGB\"); W, H = im.size\nA = np.asarray(im, dtype=np.float32)\nflags, notes = [], []\n\ndef hexc(c): return \"#%02X%02X%02X\" % tuple(int(round(float(v))) for v in c)\ndef rgb(h): return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)\ndef lab(c):\n    c = np.asarray(c, dtype=np.float64) / 255.0\n    c = np.where(c > .04045, ((c + .055) / 1.055) ** 2.4, c / 12.92)\n    X = (c @ np.array([.4124, .3576, .1805])) / .95047\n    Y = (c @ np.array([.2126, .7152, .0722]))\n    Z = (c @ np.array([.0193, .1192, .9505])) / 1.08883\n    f = lambda t: np.where(t > .008856, np.cbrt(t), 7.787 * t + 16 / 116)\n    return np.array([116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))])\ndef dE(a, b): return float(np.linalg.norm(lab(a) - lab(b)))\n\n# 1. Brand-field colour lock (the generator drifts a flat panel a few shades per render).\nfield = spec.get(\"field\", \"-\") or \"-\"\nif field != \"-\":\n    T = rgb(field)\n    s = A[::4, ::4].reshape(-1, 3); q = (s // 8).astype(np.int32)\n    keys = q[:, 0] * 1024 + q[:, 1] * 32 + q[:, 2]\n    vals, cnt = np.unique(keys, return_counts=True); kk = vals[np.argmax(cnt)]\n    kq = np.array([kk // 1024, (kk // 32) % 32, kk % 32])\n    near = s[np.all(np.abs(q - kq) <= 1, axis=1)]; M = near.mean(axis=0)\n    if len(near) > .12 * len(s) and np.linalg.norm(M - T) < 75:\n        d = np.linalg.norm(A - M, axis=2)\n        wgt = np.clip((64.0 - d) / 28.0, 0, 1)[..., None]\n        A = np.clip(A + wgt * (T - M), 0, 255)\n        notes.append(\"field %s->#%s\" % (hexc(M), field.upper()))\n    else:\n        flags.append(\"FIELDCOLOR\")\ngrad = spec.get(\"grad\")\nif grad:  # T3: the dark violet ground, sampled top-right where nothing else sits\n    patch = A[int(H * .02):int(H * .08), int(W * .80):int(W * .96)].reshape(-1, 3)\n    if len(patch):\n        med = np.median(patch, axis=0)\n        if dE(med, rgb(grad[0])) > 14 and dE(med, rgb(grad[1])) > 14: flags.append(\"FIELDCOLOR\")\n        notes.append(\"ground %s\" % hexc(med))\n\nL = 0.2126 * A[..., 0] + 0.7152 * A[..., 1] + 0.0722 * A[..., 2]\n_lw0, _lh0 = Image.open(LOGOS[\"white\"]).size\nlw = int(spec[\"w\"]); lh = round(lw * _lh0 / _lw0)\nx, y = int(spec[\"x\"]), int(spec[\"y\"])\nground = spec.get(\"ground\", \"panel\")\n\n# 2. Template 2 only: centre the logo in the top of the white speech bubble.\nif ground == \"bubble\":\n    white = A.min(axis=2) > 226\n    c0, c1 = int(spec[\"bx\"][0] * W), int(spec[\"bx\"][1] * W)\n    rows = white[:int(H * .6), c0:c1].mean(axis=1)\n    need = max(12, lh // 2); run = 0; top = None\n    for r, v in enumerate(rows):\n        run = run + 1 if v > .55 else 0\n        if run >= need: top = r - run + 1; break\n    ok = False\n    if top is not None:\n        row = white[min(H - 1, top + need)]\n        best, cur, b_ = 0, 0, 0\n        for i_ in range(W):\n            cur = cur + 1 if row[i_] else 0\n            if cur > best: best, b_ = cur, i_\n        a_ = b_ - best + 1\n        if best > lw * 1.3:\n            x = round((a_ + b_) / 2 - lw / 2); y = top + int(spec.get(\"pad\", 40))\n            notes.append(\"bubble x%d-%d top %d\" % (a_, b_, top)); ok = True\n    if not ok: flags.append(\"BUBBLE?\")\n    ground = \"panel\"\n\nsafe = spec.get(\"safeTop\")\nif safe is not None and y < int(safe): flags.append(\"SAFEZONE\")\n\n# 3. Check the logo zone (logo box + clear space) BEFORE placing.\npad = round(lh * .6)\nx0, y0, x1, y1 = max(0, x - pad), max(0, y - pad), min(W, x + lw + pad), min(H, y + lh + pad)\nreg = L[y0:y1, x0:x1]\nedge = (np.abs(np.diff(reg, axis=1))[:-1, :] + np.abs(np.diff(reg, axis=0))[:, :-1]) > 45\nedge_frac = float(edge.mean()) if edge.size else 0.0\nrgbz = A[y0:y1, x0:x1].reshape(-1, 3); med = np.median(rgbz, axis=0)\nflat_share = float(np.mean(np.max(np.abs(rgbz - med), axis=1) < 18))\nif ground == \"photo\":\n    pale_flat = float(np.mean((rgbz.min(axis=1) > 200) & (np.max(np.abs(rgbz - med), axis=1) < 14)))\n    if pale_flat > .6: flags.append(\"PLACEHOLDER\")\n    elif edge_frac > .05: flags.append(\"COLLISION\")\nelif edge_frac > .012:\n    flags.append(\"COLLISION\")\n\n# 4. CTA: find the solid gold button, check it against #EBA800 and pull it onto the exact gold.\nG = np.array([235, 168, 0], dtype=np.float32)\nif spec.get(\"cta\", True):\n    gm = (np.linalg.norm(A - G, axis=2) < 70) & (A[..., 0] - A[..., 2] > 120)\n    f = max(2, W // 270)\n    hh, ww = H // f, W // f\n    small = gm[:hh * f, :ww * f].reshape(hh, f, ww, f).mean(axis=(1, 3)) > .5\n    seen = np.zeros_like(small); cand = None\n    for i in range(hh):\n        for j in range(ww):\n            if not small[i, j] or seen[i, j]: continue\n            st = [(i, j)]; seen[i, j] = True; n = 0; r0 = r1 = i; q0 = q1 = j\n            while st:\n                a, b = st.pop(); n += 1\n                r0, r1, q0, q1 = min(r0, a), max(r1, a), min(q0, b), max(q1, b)\n                for da, db in ((1, 0), (-1, 0), (0, 1), (0, -1)):\n                    na, nb = a + da, b + db\n                    if 0 <= na < hh and 0 <= nb < ww and small[na, nb] and not seen[na, nb]:\n                        seen[na, nb] = True; st.append((na, nb))\n            bw, bh = q1 - q0 + 1, r1 - r0 + 1\n            if n * f * f < .0012 * W * H or not (1.6 <= bw / bh <= 14): continue\n            X0, Y0, X1, Y1 = q0 * f, r0 * f, (q1 + 1) * f, (r1 + 1) * f\n            box = gm[Y0:Y1, X0:X1]; fill = float(box.mean())\n            dark = float((L[Y0:Y1, X0:X1] < 70).mean())\n            if fill < .5 or not (.015 <= dark <= .38): continue\n            if cand is None or n > cand[0]: cand = (n, X0, Y0, X1, Y1)\n    if cand is None:\n        flags.append(\"NOCTA\")\n    else:\n        _, X0, Y0, X1, Y1 = cand\n        px = A[Y0:Y1, X0:X1][gm[Y0:Y1, X0:X1]]\n        M = np.median(px, axis=0); e = dE(M, G)\n        if e > 35:\n            flags.append(\"CTACOLOR\"); notes.append(\"CTA %s dE %.0f\" % (hexc(M), e))\n        else:\n            if e > 2:\n                X0, Y0, X1, Y1 = max(0, X0 - 3), max(0, Y0 - 3), min(W, X1 + 3), min(H, Y1 + 3)\n                sub = A[Y0:Y1, X0:X1]\n                d = np.linalg.norm(sub - M, axis=2)\n                wgt = np.clip((50.0 - d) / 20.0, 0, 1)[..., None]\n                A[Y0:Y1, X0:X1] = np.clip(sub + wgt * (G - M), 0, 255)\n            notes.append(\"CTA %s->#EBA800 (dE %.1f)\" % (hexc(M), e))\n\nout_im = Image.fromarray(A.astype(np.uint8), \"RGB\")\n\n# 5. Flat brand panel (T1 field, T2 bubble) with a few stray marks: even it out. Never on gradients or photos.\nif spec.get(\"even\") and flat_share >= .80 and \"COLLISION\" not in flags:\n    patch = Image.new(\"RGB\", (x1 - x0, y1 - y0), tuple(int(v) for v in med))\n    m = Image.new(\"L\", (x1 - x0, y1 - y0), 0); k = max(3, lh // 5)\n    ImageDraw.Draw(m).rectangle((k, k, x1 - x0 - k, y1 - y0 - k), fill=255)\n    out_im.paste(patch, (x0, y0), m.filter(ImageFilter.GaussianBlur(k / 1.5)))\n    notes.append(\"stray marks evened\")\n\n# 6. Colourway is fixed per template; only overridden if it would be illegible.\nunder = np.asarray(out_im.crop((x, y, x + lw, y + lh)), dtype=np.float32)\numean = float((0.2126 * under[..., 0] + 0.7152 * under[..., 1] + 0.0722 * under[..., 2]).mean())\ncolour = spec.get(\"colour\", \"white\")\nif colour == \"white\" and umean > 170: colour = \"black\"; flags.append(\"CONTRAST\")\nelif colour in (\"black\", \"violet\") and umean < 85: colour = \"white\"; flags.append(\"CONTRAST\")\nlg = Image.open(LOGOS[colour]).convert(\"RGBA\").resize((lw, lh), Image.LANCZOS)\n\n# 7. Soft letterform shadow for a white logo over photography (as in the brand-kit templates).\nif colour == \"white\" and spec.get(\"shadow\"):\n    sh = Image.new(\"RGBA\", lg.size, (0, 0, 0, 0))\n    sh.putalpha(lg.split()[3].point(lambda v: int(v * .55)))\n    p2 = max(4, lh // 3)\n    cv = Image.new(\"RGBA\", (lw + p2 * 2, lh + p2 * 2), (0, 0, 0, 0))\n    cv.paste(sh, (p2, p2 + max(1, lh // 14)), sh)\n    cv = cv.filter(ImageFilter.GaussianBlur(max(2, lh / 9)))\n    out_im.paste(cv, (x - p2, y - p2), cv); notes.append(\"soft shadow\")\nout_im.paste(lg, (x, y), lg)\n\nq = 92\nwhile q >= 60:\n    out_im.save(out, \"JPEG\", quality=q, optimize=True, progressive=True, subsampling=2)\n    if os.path.getsize(out) <= 460000: break\n    q -= 6\nmsg = \"%s logo at (%d,%d) w%d%s | ground %.0f edges %.3f\" % (\n    colour, x, y, lw, (\" | \" + \", \".join(notes)) if notes else \"\", umean, edge_frac)\nif flags: msg += \" | FLAGS \" + \" \".join(flags)\nprint(msg)";
  var MKLOGO_SRC="import ast\nimport numpy as np\nfrom PIL import Image\nw = Image.open(\"src-white.png\").convert(\"RGBA\"); b = Image.open(\"src-black.png\").convert(\"RGBA\")\nassert w.size == b.size and w.width > 1000, \"unexpected lockup files\"\nw.save(\"logo-white.png\"); b.save(\"logo-black.png\")\na = np.asarray(b)[..., 3]; o = np.zeros(a.shape + (4,), np.uint8)\no[..., 0], o[..., 1], o[..., 2], o[..., 3] = 0x55, 0x42, 0x6A, a\nImage.fromarray(o, \"RGBA\").save(\"logo-violet.png\")\nast.parse(open(\"finish.py\").read())\nprint(\"ok %dx%d\" % w.size)";
  var LOGOWHERE={tl:"the top-left corner",tc:"the top centre",tr:"the top-right corner",bubble:"the top centre of the white speech bubble"};
  function gridSpec(id, kind){
    var G=LOGOGRID[id]||LOGOGRID.t1, C=CANVAS[kind], p=G.pos[kind];
    var a=typeof G.a==="string"?G.a:G.a[kind];
    var s={x:p[0], y:p[1], w:C.w, colour:G.colour, shadow:G.shadow, ground:G.ground, even:G.even, field:FIELD[id]||"-", a:a, where:LOGOWHERE[a]};
    if(G.pad){ s.pad=G.pad[kind]; s.bx=G.bx[kind]; }
    if(G.grad) s.grad=G.grad;
    if(kind==="portrait") s.safeTop=SAFE_TOP;
    // The zone (logo + clear space) as % of the RENDER frame, for the prompt. The 16:9 landscape
    // render loses ~3.5% top and bottom when it is trimmed to 1200x628.
    var lh=Math.round(C.w*LOGO_AR), pd=Math.round(lh*.6);
    var fx=function(v){ return v/C.W*100; };
    var fy=function(v){ var f=v/C.H; return (kind==="landscape" ? .0348+f*.9304 : f)*100; };
    s.zone=[fx(p[0]-pd), fy(p[1]-pd), fx(p[0]+C.w+pd), fy(p[1]+lh+pd)].map(function(v){ return Math.max(0,Math.round(v)); });
    return s;
  }
  function logoSpec(kind){ return gridSpec($("ground").value, kind); }
  // Exactly what finish.py reads.
  function finishSpec(L){
    var s={x:L.x, y:L.y, w:L.w, colour:L.colour, shadow:!!L.shadow, ground:L.ground, even:!!L.even, field:L.field||"-"};
    if(L.pad!=null){ s.pad=L.pad; s.bx=L.bx; }
    if(L.safeTop!=null) s.safeTop=L.safeTop;
    if(L.grad) s.grad=L.grad;
    return s;
  }
  // What the finished image must say, for the text & logo check.
  function expectedText(){
    var T=curTpl(), v=function(id){ return esc($(id).value); };
    var e={h1:v("h1"), h2:v("h2"), cta:v("cta"), sub:T.sub?v("sub"):"", deadline:T.deadline?v("deadline"):"",
      proof:T.proof==="none"?[]:[v("p1"),v("p2"),v("p3")].filter(Boolean), contact:{}};
    KINDS.forEach(function(k){
      var cs=!T.contact?"":(T.contactIn?T.contactIn[k]:"line");
      e.contact[k]=cs?[T.contact?v("phone"):"",T.contact?v("email"):""].filter(Boolean):[];
    });
    return e;
  }
  // Freeze everything a run depends on at the moment Generate is pressed, so edits or a
  // template switch while it renders can never make the three sizes disagree.
  function snapshot(){
    return {
      tpl:$("ground").value, tplName:curTpl().name,
      prompts:{master:prompt_("master"),portrait:prompt_("portrait"),landscape:prompt_("landscape")},
      logo:{master:logoSpec("master"),portrait:logoSpec("portrait"),landscape:logoSpec("landscape")},
      expect:expectedText(), product:(picked&&(picked.title||picked.label))||"",
      folder:folderName(), outOfStock:!!(picked&&picked.outOfStock), url:picked&&picked.url
    };
  }

  // ---------- brand kit (reference the generator always follows) ----------
  // Source: HitLights Ad Templates.html (Sept 2026, vault > 20_Areas/Marketing)
  // + HitLights Ad Brand Kit + Andromeda Ad Creative Spec, vault > 20_Areas/Marketing.
  // Colours pulled live from hitlights.com's theme. Do not loosen these without updating the kit.
  // Four templates: T1 Collage Hero + T2 Speech-Bubble Hero (Pillar A, Pro-Trust),
  // T3 Discount Deadline (Pillar B, Promo Urgency), T4 Styled Room Hero (Pillar C, Aesthetic Lifestyle),
  // T5 Glow Room Hero (Pillar A, Pro-Trust) — added Sept 16, 2026 from the "Built For Professionals" creative set.
  var BRAND={
    purpleDeep:"#523875", purple:"#675185", gold:"#EBA800", goldBright:"#FBCA10", ink:"#232323", cream:"#FBF6EE", blush:"#F3E4DA",
    promoTop:"#241A30", promoBottom:"#120C18",
    face:"Montserrat, a geometric sans-serif — headings heavy at 600 to 800, body regular",
    craftTrade:"Lighting: large soft key from upper left, a warm practical LED glow as secondary source, controlled specular highlights on product surfaces. Register: contemporary premium hardware advertising — crisp macro detail, controlled reflections, deep saturated shadows, clean architectural geometry.",
    craftLife:"Lighting: warm low-Kelvin practical LED glow as the hero light source with soft ambient fill, warmer white balance than the trade register. Register: warm, lived-in, editorial interior photography — styled but not staged.",
    // CTA system - solid only. No ad that has performed uses a ghost button.
    ctaPill:"The call to action is always a solid gold #EBA800 fully rounded pill with extra-bold dark ink #232323 lettering and a soft drop shadow beneath it, high contrast, never an outline or ghost button, never a square-cornered or rectangular button, and never any colour other than that gold.",
    // Template 3 is the one template whose button is a rounded rectangle rather than a pill.
    ctaPromo:"The call to action is a solid gold #EBA800 button with slightly rounded corners — a rounded rectangle, not a full pill — with extra-bold dark ink #232323 lettering, high contrast, never an outline or ghost button, and never any colour other than that gold.",
    // Performance ads run slightly louder than organic, without tipping into cheap.
    punch:"High saturation and strong contrast with deep shadows and bright highlights — built to fight a busy social feed — but no neon oversaturation, no HDR halos and no synthetic stock sheen.",
    typeRule:"All lettering set in "+"Montserrat or an identical heavy geometric sans-serif, tight tracking, crisp, correctly spelled, evenly kerned, and comfortably inside the frame with clear margins at the top and bottom.",
    // Templates show the seal as a small white circle with violet lettering. It may only repeat a real proof line.
    trust:"Trust seal: only if one of the proof lines is a certification or a warranty, that same wording may also appear as a small white circular seal with extra-bold violet #523875 lettering, carrying no words beyond that proof line — present and legible, never competing with the headline or the product. With no such proof line there is no seal."
  };
  var PHOTO_TRADE="Photography: job-site and installer realism — real hands, real hardware, real rough-in conditions, upscale but neutral interiors.";
  var PHOTO_LIFE="Photography: styled, warm, lived-in domestic rooms — a bedroom shelf, a kitchen backsplash, a vanity mirror. Absolutely no tool belts, no job site, no work gloves, no exposed construction — this register exists to avoid trade imagery entirely.";

  // Each template: palette/system copy, lighting, photography, layouts per canvas, CTA style,
  // which text elements it carries, and what the recomposed sizes must keep.
  var TPL={
    t1:{
      name:"Template 1 — Collage Hero", pillar:"Pillar A · Pro-Trust", register:"trade",
      system:"Palette (HitLights Template 1, Pro-Trust): deep violet #523875 as the full-bleed field, #675185 as its lighter violet tone, bright gold #FBCA10, gold #EBA800, ink #232323, pure white. Gold is only ever the warm accent, reading as the glow of an LED: bright gold #FBCA10 for headline line one, for the proof-line bullets, and for a quiet fine polka-dot grid at roughly half opacity anchored in the bottom-left corner; gold #EBA800 for the CTA pill and nothing else. Headline line one in bright gold #FBCA10, extra-bold and larger; line two in white, bold and slightly smaller.",
      craft:BRAND.craftTrade, photo:PHOTO_TRADE, cta:BRAND.ctaPill, ctaNoun:"pill",
      skeleton:"Layout skeleton, in this order: reserved logo space, then a two-line stacked headline, then the hero visual, then the proof points, then the CTA. Rule of thirds, one dominant focal anchor, eye landing on the subject within half a second.",
      proof:"bullets", contact:true, seal:true, deadline:false,
      master:"Square frame, the whole canvas the deep violet #523875 field (Template 1, Collage Hero). Top-left: the reserved logo space, and beneath it the two-line headline. On the right, starting about a third of the way down, the scene photograph as a large inset with softly rounded corners, roughly 60% of the frame width. Overlapping that photograph's lower-left corner, the product from the reference image as a clean hero cut-out with a warm glow and a soft drop shadow. The proof lines stacked in the left column beneath the headline, beside the photograph. The trust seal, if there is one, at the photograph's lower-right edge. The gold pill centred along the bottom with the contact line beneath it. The bright gold dot grid in the bottom-left corner, behind the product cut-out.",
      portrait:"The violet field throughout. The reserved logo space and the two-line headline across the top, the inset photograph through the middle with the glowing product cut-out overlapping its lower-left corner, the proof lines beneath, then the gold pill and contact line centred along the bottom. The dot grid stays in the bottom-left corner.",
      landscape:"The violet field throughout. A type column down the left, in this reading order — reserved logo space, headline, proof points, gold pill with the contact line beneath it — and the inset photograph filling the right with the glowing product cut-out overlapping its lower-left corner. The dot grid stays in the bottom-left corner.",
      keep:"the same violet field and bright gold dot texture in the bottom-left corner, the same softly rounded corners on the inset photograph, the same glowing product cut-out",
      palette:"violet #523875 and #675185, bright gold #FBCA10, gold #EBA800, ink #232323, white",
      avoidExtra:"",
      labels:{h1:"Headline line 1 — bright gold", h2:"Headline line 2 — white"}
    },
    t2:{
      name:"Template 2 — Speech-Bubble Hero", pillar:"Pillar A · Pro-Trust", register:"trade",
      system:"Palette (HitLights Template 2, Pro-Trust Speech-Bubble): the photograph itself is the ground, in cool blue-grey daylight tones; the brand is carried by a clean white rounded speech-bubble panel. Gold #EBA800 for the CTA pill, ink #232323 for the headline and proof line, white for the bubble and the contact line. Headline in ink #232323, extra-bold, centred, both lines the same size. No full violet field and no dot texture in this template.",
      craft:BRAND.craftTrade, photo:PHOTO_TRADE+" Cool, natural daylight on site, so the white bubble and the gold pill stand out against it.", cta:BRAND.ctaPill, ctaNoun:"pill",
      skeleton:"Layout skeleton, in this order: the speech bubble carrying the reserved logo space, headline, proof line and CTA; then the product; then the contact line. One dominant focal anchor, eye landing on the bubble headline first and the product second.",
      proof:"inline", contact:true, seal:false, deadline:false,
      master:"Square frame (Template 2, Speech-Bubble Hero). The scene photograph fills the entire frame edge to edge. Across the upper part, a solid pure-white speech-bubble panel with generously rounded corners and a soft drop shadow, its top edge about 4% down from the top of the frame and its sides about 6% in from each edge; inside it, centred, in this order — the reserved logo space, the two-line headline in ink, the proof points on a single line separated by thin vertical bars, and the gold pill. The product from the reference image sits prominently in the lower part of the frame, as a clean arrangement or in use, clear of the bubble. Centred along the bottom, just above a clear margin, the contact line in small white lettering with a subtle shadow for legibility.",
      portrait:"The photograph fills the frame. The solid white speech bubble across the upper third, its top edge 14% down from the top of the frame and its sides about 6% in from each edge, with the reserved logo space, headline, proof line and gold pill centred inside; the product through the middle and lower frame; the contact line centred near the bottom above a clear margin.",
      landscape:"The photograph fills the frame. The solid white speech bubble on the left half, spanning from about 4% to 52% of the frame width, its top edge about 10% down from the top of the frame, with the reserved logo space, headline, proof line and gold pill centred inside; the product in the right half; the contact line small and white along the bottom, centred beneath the bubble.",
      keep:"the same full-bleed photograph, the same white rounded speech bubble with its soft shadow, the same product arrangement",
      palette:"white, deep violet #523875, gold #EBA800, ink #232323, and the natural colours of the photograph",
      avoidExtra:", no violet background field",
      labels:{h1:"Headline line 1 — ink, inside the bubble", h2:"Headline line 2 — ink"}
    },
    t3:{
      name:"Template 3 — Discount Deadline", pillar:"Pillar B · Promo Urgency", register:"promo",
      system:"Palette (HitLights Template 3, Promo Urgency): a near-black deep violet ground grading from #241A30 at the top to #120C18 at the bottom, with a soft blurred glow of gold #EBA800 and violet #675185 light behind the product; bright gold #FBCA10 for the offer line; white for the second headline line and the deadline line; gold #EBA800 for the CTA button with ink #232323 lettering. The offer line in bright gold #FBCA10, extra-bold and very large — the loudest element in the frame; line two in white, bold and much smaller.",
      craft:"Lighting: moody, low-key ambient room light with the product catching a warm LED glow; deep shadows and rich contrast. Register: premium retail promotion — urgent, never cheap.",
      photo:"Photography: the product as an angled flat-lay, tilted a few degrees, softly lit, over a blurred ambient-lit room background.", cta:BRAND.ctaPromo, ctaNoun:"button",
      skeleton:"Layout skeleton, in this order: reserved logo space, then the offer line and line two, then the product, then the deadline line and the CTA. The offer reads first, within half a second.",
      proof:"none", contact:false, seal:false, deadline:true,
      master:"Square frame (Template 3, Discount Deadline). The whole canvas the dark violet ground with a soft gold-and-violet glow behind the centre. Top-left: the reserved logo space. Beneath it, starting about a quarter of the way down, the offer line and then line two, left-aligned. In the lower right, the product as an angled flat-lay tilted a few degrees anticlockwise over a blurred ambient room. Along the bottom-left, the deadline line in white and directly beneath it the gold CTA button.",
      portrait:"The dark violet ground and glow throughout. The reserved logo space top-left, the offer line and line two beneath it, the tilted product flat-lay filling the middle, then the deadline line and the gold button along the bottom-left.",
      landscape:"The dark violet ground and glow throughout. Down the left half, in this reading order — reserved logo space, offer line, line two, deadline line, gold button — and the tilted product flat-lay filling the right half.",
      keep:"the same dark violet ground and gold-and-violet glow, the same tilted product flat-lay, the same deadline line word for word",
      palette:"dark violet #241A30 to #120C18, violet #675185, bright gold #FBCA10, gold #EBA800, ink #232323, white",
      avoidExtra:", no fake prices, no percentages or dates other than the exact wording given",
      labels:{h1:"Offer — bright gold, the largest line (e.g. 11% OFF)", h2:"Line 2 — white (e.g. LED Kits — Limited Time)"}
    },
    t5:{
      name:"Template 5 — Glow Room Hero", pillar:"Pillar A · Pro-Trust", register:"trade",
      system:"Palette (HitLights Template 5, Glow Room Hero): the photograph is the ground — a dark, moody, warm interior lit almost entirely by warm-white LED strip light of around 2700 to 3000K in ceiling coves, under shelves and cabinets and behind wall panels, with deep brown-charcoal shadows. All lettering pure white with a soft dark drop shadow for legibility, over a gentle darkening of the photograph behind the type. Gold #EBA800 only for the CTA pill, with ink #232323 lettering. No violet, no dot texture, and no panels, boxes or colour bands behind the type. Headline in white, extra-bold, very large, title case; subheadline in white at a regular weight, roughly a third of the headline size.",
      craft:"Lighting: the LED strips in the room and the glowing product are the only light sources; warm amber highlights, deep low-key shadows, rich contrast. Register: premium architectural-lighting advertising — crisp, cinematic, never cheap.",
      photo:"Photography: a high-end modern residential interior — concrete or wood-panelled walls, an open living room and kitchen — shot at night with the main lights off, so the only light is warm LED cove, shelf and under-cabinet lighting. No people.",
      cta:BRAND.ctaPill+" The pill's wording is followed by a small right-pointing arrow in the same ink colour.", ctaNoun:"pill",
      skeleton:"Layout skeleton, in this order: clear space for the logo, then the two-line headline, then the subheadline, then the CTA, with the glowing product as the foreground hero. The headline reads first, the product second.",
      proof:"none", sub:true, contact:true, contactIn:{master:"stacked",portrait:"inline",landscape:""}, seal:false, deadline:false,
      master:"Square frame (Template 5, Glow Room Hero). The interior photograph fills the whole frame edge to edge. Centred in the upper 55% of the frame, stacked and centre-aligned: clear space for the logo, the two-line headline very large, the subheadline on two lines, then the gold pill. In the lower-left and centre foreground, the product from the reference image, large, photoreal and lit up with a warm glow, running out past the left and bottom edges of the frame. In the bottom-right corner, right-aligned on two small lines, the contact details, each followed by a small white circular icon — a phone handset after the phone number, an envelope after the email.",
      portrait:"The photograph fills the frame. Centred between 14% and 50% of the frame height, stacked and centre-aligned: clear space for the logo, the very large two-line headline, the subheadline on two lines, the gold pill, and directly beneath the pill the contact details on one small white line separated by a vertical bar. The glowing product fills the bottom third of the frame, running out past both side edges and the bottom edge.",
      landscape:"The photograph fills the frame. A right-aligned type block over the right 45% of the frame, stacked: clear space for the logo, the very large two-line headline, the subheadline on two lines, then the gold pill. The glowing product coils across the lower-left of the frame, running out past the left and bottom edges. No contact details in this size.",
      keep:"the same interior photograph and its warm LED lighting, the same large glowing product, the same white lettering with soft shadows, the same subheadline word for word",
      palette:"white, gold #EBA800, ink #232323, and the warm amber and charcoal tones of the photograph",
      avoidExtra:", no violet, no coloured panels or boxes behind the text, no people",
      labels:{h1:"Headline line 1 — white, very large", h2:"Headline line 2 — white, very large"}
    },
    t4:{
      name:"Template 4 — Styled Room Hero", pillar:"Pillar C · Aesthetic Lifestyle", register:"lifestyle",
      system:"Palette (HitLights Template 4, Aesthetic Lifestyle): warm cream #FBF6EE as the ground, blush #F3E4DA as its secondary warm tone, violet #675185 used only as a narrow vertical accent bar beside the type and never as a full-bleed block, gold #EBA800 as the single high-saturation accent, ink #232323 for type, white. This is the lighter register of the same brand system, so it reads as home content in feed rather than a trade ad. Headline in ink #232323 at a bold rather than extra-bold weight, both lines the same size, with only the final word of line two picked out in gold #EBA800. No dot texture in this register.",
      craft:BRAND.craftLife, photo:PHOTO_LIFE, cta:BRAND.ctaPill, ctaNoun:"pill",
      skeleton:"Layout skeleton, in this order: the hero photograph with a calm corner kept clear for the logo, then the two-line stacked headline, then the proof points, then the CTA. Rule of thirds, one dominant focal anchor, eye landing on the subject within half a second.",
      proof:"bullets", contact:true, seal:true, deadline:false,
      master:"Square frame (Template 4, Styled Room Hero). The scene photograph fills the upper 60% of the frame edge to edge, its two bottom corners softly rounded where it meets the panel below. Over the photograph: a calm, darker corner of the scene kept clear for the logo at the top-left, and the trust seal, if there is one, top-right. The lower 40% is the warm cream #FBF6EE panel, with a narrow vertical violet #675185 accent bar running down its left edge; indented to the right of that bar, in this reading order — headline, proof lines, gold pill with the contact line beneath it.",
      portrait:"Photograph across the upper 55% of the frame edge to edge with its bottom corners softly rounded, a calm, darker corner of the scene kept clear for the logo over its top-left and the seal, if any, over its top-right. The cream #FBF6EE panel across the lower portion with the violet #675185 accent bar down its left edge, and to the right of the bar in this reading order — headline, proof lines, gold pill, contact line.",
      landscape:"Photograph filling the left 55% of the frame edge to edge with its right-hand corners softly rounded, a calm, darker corner of the scene kept clear for the logo over its top-left and the seal, if any, over its top-right. The cream #FBF6EE panel filling the right portion with the violet #675185 accent bar down its left edge, and to the right of the bar in this reading order — headline, proof points, gold pill with the contact line beneath it.",
      keep:"the same cream panel and violet accent bar, the same softly rounded corners on the photograph",
      palette:"cream #FBF6EE and blush #F3E4DA, violet #675185 and #523875, gold #EBA800, ink #232323, white",
      avoidExtra:", no tool belts, no job site, no work gloves",
      labels:{h1:"Headline line 1 — ink", h2:"Headline line 2 — ink, last word in gold"}
    }
  };
  function curTpl(){ return TPL[$("ground").value]||TPL.t1; }

  // Sample copy per template. A field still holding the previous template's sample is swapped
  // for the new one on a template change; anything the user typed is left alone.
  var SAMPLE={
    t1:{h1:"DRIVER + DIMMER.", h2:"ONE GANG BOX.", sub:"", p1:"UL Listed & Class 2", p2:"100% to 0.3% dimming", p3:"6-year warranty", cta:"SHOP EZDIM PRO", deadline:"",
        scene:"A licensed electrician's gloved hands seating the product into a single steel gang box in an open drywall wall, neat copper conductors visible, deep violet shadow behind."},
    t2:{h1:"LED Kits Built", h2:"for the Job Site", sub:"", p1:"UL Listed", p2:"Class 2", p3:"6-Yr Warranty", cta:"View Collection", deadline:"",
        scene:"A contractor in daylight on a commercial fit-out, open ceiling grid and ladder behind, the product laid out on a clean workbench in the foreground."},
    t3:{h1:"", h2:"LED Kits \u2014 Limited Time", sub:"", p1:"", p2:"", p3:"", cta:"Shop Now", deadline:"",
        scene:"An oak side table in a softly lit living room at dusk, warm LED shelf lighting glowing in the blurred background."},
    t4:{h1:"Your space,", h2:"your glow.", sub:"", p1:"Instant ambiance", p2:"Plug-and-play setup", p3:"6-year warranty", cta:"Shop the Look", deadline:"",
        scene:"A styled bedroom shelf at dusk, books and a ceramic vase glowing under warm LED strip light, a linen-covered bed softly out of focus."},
    t5:{h1:"Built For", h2:"Professionals", sub:"Premium LED strips built for consistent performance", p1:"", p2:"", p3:"", cta:"View Our Collection", deadline:"",
        scene:"A high-end open-plan living room and kitchen at night, main lights off, warm LED cove lighting along the ceiling and under the cabinets."}
  };
  var SAMPLE_FIELDS=["h1","h2","sub","p1","p2","p3","cta","deadline","scene"];
  var lastTpl=$("ground").value;
  function swapSamples(){
    var from=SAMPLE[lastTpl]||{}, to=SAMPLE[$("ground").value]||{};
    SAMPLE_FIELDS.forEach(function(f){
      var el=$(f); if(!el) return;
      // The Template 3 offer and deadline belong to that promo only: never carry them into another template.
      var promoOnly=lastTpl==="t3" && (f==="h1"||f==="deadline");
      if(promoOnly || el.value.trim()===(from[f]||"").trim()) el.value=to[f]||"";
    });
    lastTpl=$("ground").value;
  }

  // ---------- template switcher: labels and which fields apply ----------
  function applyTpl(){
    var T=curTpl();
    document.querySelector('label[for="h1"]').textContent=T.labels.h1;
    document.querySelector('label[for="h2"]').textContent=T.labels.h2;
    $("proofWrap").hidden=(T.proof==="none");
    $("contactWrap").hidden=!T.contact; $("contactHint").hidden=!T.contact;
    $("subWrap").hidden=!T.sub;
    $("deadlineWrap").hidden=!T.deadline;
    var LM=LIMITS[$("ground").value]||{};
    document.querySelector('label[for="cta"]').textContent="CTA "+T.ctaNoun+" \u2014 "+LM.ctaWords[0]+" to "+LM.ctaWords[1]+" words";
    $("tplnote").textContent=T.pillar+" · "+T.name;
    checkLimits();
  }

  // ---------- copy limits per template (what fits the layout without shrinking or wrapping) ----------
  // Same limits the drafting brief uses. Generate and the prompt pack refuse copy that breaks them.
  var LIMITS={
    t1:{h1:24, h2:24, hl:40, p:28, cta:22, ctaWords:[2,4]},
    t2:{h1:24, h2:24, hl:40, p:20, cta:20, ctaWords:[2,3]},
    t3:{h1:12, h2:32, deadline:32, cta:16, ctaWords:[2,3]},
    t4:{h1:22, h2:22, hl:40, p:28, cta:20, ctaWords:[2,4]},
    t5:{h1:14, h2:16, hl:26, sub:60, subWords:[5,8], cta:22, ctaWords:[2,3]}
  };
  var LIMIT_FIELDS=["h1","h2","sub","deadline","p1","p2","p3","cta"];
  LIMIT_FIELDS.forEach(function(id){
    var el=$(id); if(!el) return;
    var n=document.createElement("span"); n.className="lim"; n.id="lim-"+id;
    el.insertAdjacentElement("afterend",n);
    el.addEventListener("input",checkLimits);
  });
  function words(v){ return v.trim()?v.trim().split(/\s+/).length:0; }
  function checkLimits(){
    var T=curTpl(), LM=LIMITS[$("ground").value]||{}, bad=[];
    function lim(id,max,label,wr){
      var el=$(id), n=$("lim-"+id); if(!el||!n) return;
      var used=!(el.closest("[hidden]")), v=el.value.trim(), msg="", over=false;
      if(used && max){
        msg=v.length+"/"+max;
        if(v.length>max){ over=true; bad.push(label+" is "+v.length+" characters (max "+max+")"); }
      }
      if(used && wr && v){
        var w=words(v); msg+=(msg?" \u00b7 ":"")+w+" word"+(w===1?"":"s");
        if(w<wr[0]||w>wr[1]){ over=true; bad.push(label+" is "+w+" words ("+wr[0]+"\u2013"+wr[1]+")"); }
      }
      n.textContent=used?msg:""; n.classList.toggle("over",over);
    }
    lim("h1",LM.h1,"Headline line 1"); lim("h2",LM.h2,"Headline line 2");
    lim("sub",T.sub?LM.sub:0,"Subheadline",T.sub?LM.subWords:null);
    lim("deadline",T.deadline?LM.deadline:0,"Deadline line");
    ["p1","p2","p3"].forEach(function(p,i){ lim(p,T.proof==="none"?0:LM.p,"Proof point "+(i+1)); });
    lim("cta",LM.cta,"CTA",LM.ctaWords);
    if(LM.hl){
      var tot=$("h1").value.trim().length+$("h2").value.trim().length;
      if(tot>LM.hl) bad.push("Headline is "+tot+" characters across both lines (max "+LM.hl+")");
    }
    return bad;
  }
  $("ground").addEventListener("change",function(){ swapSamples(); applyTpl(); });
  applyTpl();

  // ---------- prompt ----------
  function esc(s){ return String(s||"").replace(/\s+/g," ").replace(/"/g,"\u201d").trim(); }
  function prompt_(kind){
    var T=curTpl();
    var h1=esc($("h1").value), h2=esc($("h2").value), cta=esc($("cta").value), phone=T.contact?esc($("phone").value):"", email=T.contact?esc($("email").value):"", sub=T.sub?esc($("sub").value):"", dl=T.deadline?esc($("deadline").value):"";
    // Contact: which form this template uses at this size ("line" by default; T5 varies per canvas).
    var cStyle = !T.contact||!(phone||email) ? "" : (T.contactIn ? T.contactIn[kind] : "line");
    var ctText = cStyle==="stacked" ? [phone,email].filter(Boolean).map(function(x){return '"'+x+'"'}).join(" above ")
               : cStyle ? '"'+[phone,email].filter(Boolean).join(cStyle==="inline"?" | ":" · ")+'"' : "";
    var ct = cStyle ? [phone,email].filter(Boolean).join(cStyle==="inline"?" | ":" · ") : "";
    var ps=T.proof==="none"?[]:[esc($("p1").value),esc($("p2").value),esc($("p3").value)].filter(Boolean);
    var sys=T.system+" "+T.craft+" "+T.skeleton+" "+BRAND.punch;
    var proofTxt="";
    if(ps.length && T.proof==="bullets") proofTxt=' Beneath the headline '+ps.length+' short proof line'+(ps.length===1?"":"s")+', each preceded by its own small gold round bullet on the same line as its text: '+ps.map(function(x){return '"'+x+'"'}).join(", ")+'.';
    if(ps.length && T.proof==="inline") proofTxt=' Beneath the headline a single short proof line reading "'+ps.join(' | ')+'", the items separated by thin vertical bars.';
    var typo='[TYPOGRAPHY] Integrated typography, placed as the composition describes. '+BRAND.typeRule+' A stacked two-line headline reading "'+h1+'" then "'+h2+'".'+(sub?' Beneath it the subheadline reading "'+sub+'".':'')+proofTxt+
      (dl?' The deadline line reading "'+dl+'".':'')+
      ' Then the CTA: '+T.cta+' The '+T.ctaNoun+' reads "'+cta+'".'+(cStyle==="stacked"?' The contact details on two small right-aligned lines reading '+ctText+', each followed by its small white circular icon.':'')+(cStyle==="inline"||cStyle==="line"?' A small contact line reading '+ctText+'.':'')+
      ' No other words anywhere in the image, apart from markings already printed on the product itself, which stay exactly as in the reference photo.';
    var avoid="[AVOID] no AI artifacts, no warped or smeared text, no fake words baked into the image, no garbled letters, no melted typography, no fictional logos, no duplicated text, no plastic look, no cartoonish rendering, no extra fingers, no extra limbs, no warped fingers or hands, no melted geometry, no oversaturated HDR, no HDR halos, no flat fluorescent lighting, no generic stock photography poses, no cliche compositions, no random unrelated brand logos, no wordmark, no brand name, no logo of any kind, no \u00ae, no \u2122, no trademark or copyright symbols, no watermarks, no empty placeholder shapes, blank boxes, tabs or patches, no garbled or half-formed lettering \u2014 any marking too small to render cleanly is left blank instead, no flat solid colour bands disconnected from the scene, no text near the top or bottom edge of the frame, no outline or ghost buttons, no colour outside the HitLights palette"+T.avoidExtra+(T.seal?"":", no badge or seal");
    var LG=logoSpec(kind);
    var where=LG.where||LOGOWHERE[LG.a];
    var zt="inside the box running from "+LG.zone[0]+"% to "+LG.zone[2]+"% of the frame width and from "+LG.zone[1]+"% to "+LG.zone[3]+"% of the frame height";
    var noMark=" Draw no logo, no wordmark, no brand name and no lettering of any kind there, and no brand mark anywhere else in the image either. No registered-trademark or trademark symbol anywhere in the image \u2014 no \u00ae and no \u2122.";
    var logoBlock = LG.ground==="photo"
      ? "[LOGO ZONE \u2014 keep this part of the photograph clear]\nThe real HitLights logo is composited afterwards at a FIXED position: "+LG.where+", "+zt+". Keep that box calm and fairly dark \u2014 a quiet area of the scene such as cabinetry, a shadowed wall or ceiling \u2014 with no bright highlights, no text, no product and no objects of interest in it. Every headline, line of text, button, seal and the product sit outside that box. The photograph simply continues through it: do not draw any shape, panel, tab, badge, box, circle or blank patch there to hold the logo."+noMark
      : LG.ground==="bubble"
      ? "[LOGO ZONE \u2014 reserved inside the bubble, leave it EMPTY]\nThe real HitLights logo is composited afterwards, centred in the top of the white speech bubble. Leave the top band of the bubble plain, empty white from its top edge down to about "+LG.zone[3]+"% of the frame height, and start the headline below that band."+noMark
      : "[LOGO ZONE \u2014 reserved, leave it EMPTY]\nThe real HitLights logo is composited afterwards at a FIXED position: "+LG.where+", "+zt+". Keep that box a single flat, uninterrupted stretch of the background colour with nothing drawn or printed in it. The headline starts below that box"+(LG.a==="tl"?", its left edge aligned with the box\u2019s left edge":"")+"."+noMark;
    if(kind==="master"){
      return "[BRAND SYSTEM — HitLights, non-negotiable]\n"+sys+(T.seal?" "+BRAND.trust:"")+"\n\n[PRODUCT — must match the reference image exactly]\nThe product shown in the reference image. Preserve its exact proportions, hardware details, markings and finish.\n\n[SCENE]\n"+esc($("scene").value)+" "+T.photo+"\n\n[COMPOSITION] "+T.master+"\n\n"+logoBlock+"\n\n"+typo+"\n\n[QUALITY] Scroll-stopping, magazine-quality product advertising, hyper-detailed, performance-ad ready.\n\n"+avoid+"\n\nresolution: 2k";
    }
    var layout = kind==="portrait" ? T.portrait : T.landscape;
    return "Recompose this exact advertisement into a "+(kind==="portrait"?"TALL VERTICAL 9:16":"WIDE HORIZONTAL 16:9")+" frame. This must read as the same single ad, simply laid out for a different canvas — not a new design.\n\nKEEP IDENTICAL, with no substitutions: the same photograph and the same subject within it, "+T.keep+", "+(LG.ground==="photo"?"the same calm, clear area of the photograph where the logo goes":"the same empty logo space")+", the same headline word for word (\""+h1+"\" then \""+h2+"\")"+(ps.length?", the same proof points":"")+(T.seal?", the same trust seal if there is one":"")+(dl?", the same deadline line \""+dl+"\"":"")+", the same solid gold "+BRAND.gold+" "+T.ctaNoun+" reading \""+cta+"\""+(ct?", the same contact line \""+ct+"\"":"")+", the same typeface, weights and colours throughout. The HitLights palette is fixed: "+T.palette+".\n\n"+logoBlock+"\n\nCHANGE ONLY THE ARRANGEMENT: "+layout+" Keep every element of text comfortably inside the frame with a generous clear margin at the very top and the very bottom."+(kind==="portrait"?" This frame runs in Stories and Reels, whose interface covers the top 14% and the bottom 20%: keep every line of text, the button and the logo zone between 14% and 80% of the frame height. Only the photograph and the product may extend into the top 14% and bottom 20%.":"")+(kind==="landscape"?" This frame is trimmed afterwards to 1.91:1, losing about 4% at the top and 4% at the bottom, so keep all text, the button and the logo area at least 8% in from the top and bottom edges.":"")+"\n\n"+avoid+", no new or different photograph, no changed wording, no changed colours, no extra elements\n\nresolution: 2k";
  }


  // ---------- have Claude draft the message ----------
  function fillIf(id,v){ if(typeof v==="string"&&v.trim()) $(id).value=v.trim(); }
  $("draft").addEventListener("click", function(){
    if(!sample){ return; }
    var btn=$("draft"), hint=$("drafthint");
    if(btn.disabled) return;
    if(!picked && !$("angle").value.trim()){
      hint.textContent="Pick a product first, or describe the angle here."; return;
    }
    btn.disabled=true; var was=btn.textContent; btn.textContent="Writing\u2026";
    hint.textContent="Reading the product and drafting\u2026";
    var known="";
    if(picked&&picked.title) known+="Product name: "+picked.title+"\n";
    if(picked&&picked.desc)  known+="Product listing copy: "+picked.desc+"\n";
    if(!known) known="No product listing was available \u2014 work only from the angle below.\n";
    var angle=$("angle").value.trim();
    var T=curTpl(), reg=T.register;
    var registerTxt={
      trade:"professional trade — an electrician, contractor or specifier. Reliability, code compliance and install time lead.",
      lifestyle:"consumer lifestyle — a homeowner improving a room. Mood and everyday benefit first, specification second. No trade or job-site framing at all.",
      promo:"time-limited promotion, audience-agnostic — urgency without hype."
    }[reg];
    var writeTxt={
      t1:"h1 — headline line one, 2 to 4 words, upper case, ending in a full stop.\n"+
         "h2 — headline line two, 2 to 4 words, upper case, ending in a full stop. Together the two lines are one short sentence or one tight pairing, under 40 characters in total.\n"+
         "p1, p2, p3 — three proof points, each under 28 characters, sentence case, the most concrete facts available.\n"+
         "cta — 2 to 4 words, upper case, an imperative verb first.\n",
      t2:"h1 — headline line one, 2 to 4 words, title case (in the spirit of “LED Kits Built”).\n"+
         "h2 — headline line two, 2 to 4 words, title case, finishing the thought (in the spirit of “for the Job Site”). Under 40 characters in total.\n"+
         "p1, p2, p3 — three very short proof points, each under 20 characters, title case, the most concrete facts available; they will sit on one line separated by vertical bars.\n"+
         "cta — 2 or 3 words, title case (in the spirit of “View Collection”).\n",
      t3:"h1 — return an empty string. The offer is set only by the marketer; never write a discount.\n"+
         "h2 — 2 to 5 words, title case, naming what the offer applies to and that it is limited (in the spirit of “LED Kits — Limited Time”). Do not state a percentage, price or date.\n"+
         "p1, p2, p3 — return empty strings; this template carries no proof points.\n"+
         "cta — 2 or 3 words, title case, an imperative verb first (in the spirit of “Shop Now”).\n",
      t5:"h1 — headline line one, 1 or 2 words, title case (in the spirit of “Built For”).\n"+
         "h2 — headline line two, 1 or 2 words, title case, completing the claim (in the spirit of “Professionals”). Under 26 characters in total across both lines.\n"+
         "sub — subheadline, one benefit sentence of 5 to 8 words, sentence case, no full stop (in the spirit of “Premium LED strips built for consistent performance”). No figures unless they appear in the product data.\n"+
         "p1, p2, p3 — return empty strings; this template carries no proof points.\n"+
         "cta — 2 or 3 words, title case, an imperative verb first (in the spirit of “View Our Collection”). No arrow; the design adds it.\n",
      t4:"h1 — headline line one, 2 to 4 words, sentence case, mood-first, ending in a comma (in the spirit of “Your space,”).\n"+
         "h2 — headline line two, 2 to 4 words, lower case, ending in a full stop. Its final word is the one the ad picks out in gold, so make it the payoff word. Together the two lines are one short sentence, under 40 characters in total.\n"+
         "p1, p2, p3 — three proof points, each under 28 characters, sentence case, leading with the feeling before the spec, the most concrete facts available.\n"+
         "cta — 2 to 4 words, title case, an imperative verb first (in the spirit of “Shop the Look”).\n"
    }[$("ground").value]||"";
    if(!T.sub) writeTxt+="sub — return an empty string; this template has no subheadline.\n";
    var sceneTxt = reg==="promo"
      ? "scene — ONE sentence describing the setting behind an angled product flat-lay: the surface it rests on and the softly lit room behind. Do not describe the product's appearance, do not mention text, logos, colours or layout.\n\n"
      : "scene — ONE sentence describing a photograph: who is in frame, what they are doing, where. Concrete and physical. Do not describe the product's appearance, do not mention text, logos, colours or layout.\n\n";
    var brief=
      "You write Meta ad creative for HitLights, a California LED lighting supplier selling UL-listed LED strip, dimmers, drivers and accessories to electricians, contractors, commercial specifiers and homeowners.\n\n"+
      "PRODUCT DATA (the only source of fact you have):\n"+known+"\n"+
      "ANGLE REQUESTED: "+(angle||"none given — choose the strongest angle the product data supports")+"\n"+
      "TEMPLATE: "+T.pillar+" — "+T.name+"\n"+
      "REGISTER: "+registerTxt+"\n\n"+
      "HARD RULES:\n"+
      "1. Never invent, estimate or round a specification. Use a figure ONLY if it appears in the product data above. If there are no figures there, write benefit-led proof points that state no numbers at all. A wrong number is worse than no number.\n"+
      "2. Claim nothing the product data does not support. Never invent a discount, price, offer or deadline.\n"+
      "3. Voice: confident, practical, specific. No hype, no exclamation marks, no emoji, no ALL-CAPS words inside sentences.\n\n"+
      "WRITE:\n"+writeTxt+sceneTxt+
      "Reply with JSON only, no commentary: {\"h1\":\"\",\"h2\":\"\",\"sub\":\"\",\"p1\":\"\",\"p2\":\"\",\"p3\":\"\",\"cta\":\"\",\"scene\":\"\"}";
    sample.json(brief,{modelTier:"default"}).then(function(o){
      if(!o||typeof o!=="object") throw new Error("empty");
      fillIf("h1",o.h1); fillIf("h2",o.h2); if(curTpl().sub) fillIf("sub",o.sub);
      fillIf("p1",o.p1); fillIf("p2",o.p2); fillIf("p3",o.p3);
      fillIf("cta",o.cta); fillIf("scene",o.scene);
      hint.textContent="Drafted from the product listing \u2014 read it over and edit anything that\u2019s off.";
    }).catch(function(e){
      var c=e&&e.code;
      if(c==="not_granted") hint.textContent="Drafting isn\u2019t available in this view. Fill the fields in by hand.";
      else if(c==="rate_limited") hint.textContent="Too many requests just now. Wait a moment and try again.";
      else hint.textContent="Couldn\u2019t draft it that time. Try again, or write the fields yourself.";
    }).then(function(){ btn.disabled=false; btn.textContent=was; });
  });

  // ---------- generation ----------
  // Pipeline for one set: import the product photo -> render the square master -> render
  // portrait and landscape FROM the master -> finish all three in the Higgsfield sandbox (crop to
  // exact size, lock brand colour, place the real logo on the Logo Grid) -> show them -> check
  // text & logo with Claude (vision) -> save to Drive -> write the run log.
  var CREDITS_PER_RENDER=2;   // Nano Banana Pro at 2K, per the Higgsfield transaction log (Sept 2026)
  var GD="Google Drive", DRIVE_PARENT="1jTlV2izOOli81J9ZC-pXN-ZpYO0Wfh4L";   // "Claude + Higgsfield Ad Creatives"
  var PIECE=19000;            // sandbox replies are capped near 20,000 characters per stream
  var ARFOR={master:"1:1", portrait:"9:16", landscape:"16:9"};
  var RUN=null;               // the current set: snapshot, product media, items, Drive folder, log id
  var balance=null, imgCaps=null, db=null;
  var driveEl=$("drive");

  function waitJobs(jobs){
    var tries=0;
    function once(){
      tries++;
      return mcp.callTool(HF,"jobs_wait",{jobs:jobs,timeout_seconds:15},{cache:false}).then(function(r){
        var p=r&&r.payload||{};
        if(p.all_terminal) return p.jobs||[];
        if(tries>=28) throw {code:"server_unavailable",server:HF,message:"Still rendering after about seven minutes. Higgsfield may be busy — try again shortly."};
        log("  still rendering…");
        return once();
      });
    }
    return once();
  }
  // Submit a batch and keep only the items that really became jobs. Higgsfield can reject a
  // single item (e.g. a momentary 503) while accepting the rest; those items get one retry.
  function submitBatch(requests){
    function send(reqs){
      return mcp.callTool(HF,"generate_image_batch",{requests:reqs},{cache:false}).then(function(r){
        var p=(r&&r.payload)||{};
        var ok=(p.jobs||[]).filter(function(j){ return j&&j.job_id&&j.status!=="submission_failed"; });
        return {ok:ok, r:r};
      });
    }
    return send(requests).then(function(a){
      var got={}; a.ok.forEach(function(j){ got[j.index]=1; });
      var missing=requests.filter(function(q){ return !got[q.index]; });
      if(!missing.length) return a.ok;
      log("  Higgsfield didn’t accept "+missing.length+" of the renders — retrying…");
      return new Promise(function(res){ setTimeout(res,5000); }).then(function(){ return send(missing); }).then(function(b){
        var all=a.ok.concat(b.ok);
        if(!all.length) throw {code:"tool_error",server:HF,message:"No render job was created. "+jobProblem(b.r)};
        return all;
      });
    });
  }
  function jobProblem(r){
    var p=(r&&r.payload)||{};
    if(p.unlim_choice) return "Higgsfield asked which balance to use; this tool always uses credits — run it again.";
    var e=p.errors||p.rejected||p.error;
    if(e) return String(typeof e==="string"?e:JSON.stringify(e)).slice(0,240);
    return "Check your Higgsfield credit balance.";
  }
  function firstUrl(jobs,index){
    for(var i=0;i<jobs.length;i++){ if(jobs[i].index===index) return jobs[i]; }
    return null;
  }
  // One render request. Portrait and landscape are built FROM the square master, with the
  // product photo alongside so the hardware stays exact.
  function renderReq(kind,index){
    var medias = kind==="master"
      ? [{value:RUN.productId,role:"image_references"}]
      : [{value:RUN.masterJob,role:"image_references"},{value:RUN.productId,role:"image_references"}];
    return {index:index, params:{model:"nano_banana_pro", aspect_ratio:ARFOR[kind], resolution:"2k", count:1, use_unlim:false, medias:medias, prompt:RUN.S.prompts[kind]}};
  }
  function renderOne(kind){
    var idx={master:1,portrait:2,landscape:3}[kind]+(RUN.pass++)*10;
    return submitBatch([renderReq(kind,idx)])
      .then(function(jobs){ RUN.credits+=CREDITS_PER_RENDER; return waitJobs(jobs.map(function(j){return {index:j.index,job_id:j.job_id}})); })
      .then(function(done){
        var j=firstUrl(done,idx);
        if(!j||j.status!=="completed"||!j.result_url) throw {code:"tool_error",server:HF,message:"The "+CANVAS[kind].title.toLowerCase()+" render didn’t finish ("+((j&&j.status)||"no job")+")."};
        return j;
      });
  }

  // ---------- credits ----------
  function fmtCredits(n){ return (Math.round(n*10)/10).toString(); }
  function showCost(){
    var el=$("cost"); if(!el) return;
    var set=3*CREDITS_PER_RENDER;
    el.textContent="A set uses "+set+" Higgsfield credits (3 renders × "+CREDITS_PER_RENDER+"). Regenerating one size, or repainting a blank patch, adds "+CREDITS_PER_RENDER+"."+(balance!=null?" Balance: "+fmtCredits(balance)+" credits.":"");
    el.classList.toggle("low", balance!=null && balance<set);
  }
  function refreshBalance(){
    if(!mcp||!haveHF){ showCost(); return Promise.resolve(null); }
    return mcp.callTool(HF,"balance",{},{cache:false}).then(function(r){
      var p=(r&&r.payload)||{};
      if(typeof p.credits==="number") balance=p.credits;
      showCost(); return balance;
    },function(){ showCost(); return null; });
  }

  // ---------- Higgsfield sandbox: crop, brand-colour lock, logo ----------
  // The page can't fetch the renders itself (published pages can't reach outside hosts), so the
  // Higgsfield sandbox fetches each render, finishes it and hands the JPEG back as base64 in pieces.
  // The sandbox is discarded ~10 s after a call unless background work holds it, so a 15-minute
  // keepalive starts FIRST, before any file is written.
  function sh(cmd, bg, t){
    var input={command:cmd};
    if(bg) input.background=true; else input.timeout_seconds=t||60;
    return mcp.callTool(HF,"sandbox_exec",input,{cache:false}).then(function(r){ return (r&&r.payload)||{}; });
  }
  function sq(s){ return "'"+String(s).replace(/'/g,"%27")+"'"; }
  // One plain-text setup command: the official lockups come from the HitLights Shopify CDN by URL
  // and finish.py is written as readable source. Higgsfield refuses commands that carry base64
  // blobs, so nothing is ever smuggled in as encoded bytes.
  function setupCmd(dir){
    return "set -e; mkdir -p "+dir+"; cd "+dir+
      "; curl -sfL --retry 2 "+sq(LOGO_URL.white)+" -o src-white.png"+
      "; curl -sfL --retry 2 "+sq(LOGO_URL.black)+" -o src-black.png\n"+
      "cat > finish.py <<'PYEOF'\n"+FINISH_SRC+"\nPYEOF\n"+
      "python3 - <<'PYEOF'\n"+MKLOGO_SRC+"\nPYEOF";
  }
  function prepSandbox(){
    var id="hl"+Date.now()+Math.floor(Math.random()*1e4), dir="/home/user/"+id;
    return sh("mkdir -p "+dir+" && cd "+dir+" && exec -a keep-"+id+" sleep 900", true)
    .then(function(){ return sh(setupCmd(dir),false,60); })
    .then(function(r){
      if(!/^ok \d{3,}x\d+$/m.test(String(r.stdout||"")))
        throw {code:"tool_error",server:HF,message:"The HitLights logos couldn't be prepared in the Higgsfield sandbox (official lockups from the Shopify CDN). "+String(r.stderr||r.stdout||"").slice(-240)};
      return {dir:dir, id:id};
    });
  }
  function dropSandbox(box){ if(box) sh("pkill -f keep-"+box.id+" 2>/dev/null; rm -rf "+box.dir+"; true",false,20).catch(function(){}); }
  // Crop + finish the given items in one background pass; parse each file's report.
  function finishPass(box,items){
    var tag="p"+Date.now();
    items.forEach(function(x){ x.file=x.dims+"-"+tag; x.len=0; });
    var build="cd "+box.dir+" && ("+items.map(function(x){
      return "curl -sfL "+sq(x.url)+" -o "+x.file+".src && convert "+x.file+".src -resize '"+x.dims+"^' -gravity center -extent "+x.dims+" "+x.file+".png"+
        " && python3 finish.py "+x.file+".png "+x.file+".jpg "+sq(JSON.stringify(finishSpec(x.logo)))+" > "+x.file+".mode"+
        " && base64 -w0 "+x.file+".jpg > "+x.file+".b64 && wc -c < "+x.file+".b64 > "+x.file+".len";
    }).join(" && ")+" && echo ok > ready-"+tag+" || echo fail > ready-"+tag+") > log-"+tag+" 2>&1";
    function poll(n){
      return sh("cd "+box.dir+" && for i in $(seq 1 45); do [ -f ready-"+tag+" ] && break; sleep 2; done; cat ready-"+tag+" 2>/dev/null || echo wait;"+
        " for f in *-"+tag+".len; do [ -f \"$f\" ] && printf 'len %s=%s\\n' \"${f%-"+tag+".len}\" \"$(cat $f)\"; done;"+
        " for f in *-"+tag+".mode; do [ -f \"$f\" ] && printf 'mode %s: %s\\n' \"${f%-"+tag+".mode}\" \"$(cat $f)\"; done; tail -c 400 log-"+tag,false,110)
      .then(function(p){
        var out=String(p.stdout||""), first=out.split("\n")[0].trim();
        if(first==="ok"){
          items.forEach(function(x){
            var m=out.match(new RegExp("^len "+x.dims+"=(\\d+)","m"));
            x.len=m?parseInt(m[1],10):0;
            var md=out.match(new RegExp("^mode "+x.dims+": (.*)$","m"));
            x.mode=md?md[1]:"";
            var fl=x.mode.match(/FLAGS (.*)$/);
            x.flags=fl?fl[1].trim().split(/\s+/):[];
            log("  "+x.dims+" — "+x.mode.replace(/\s*\|\s*FLAGS.*$/,""), x.flags.length?"s-err":"s-run");
            if(x.flags.length) log("    flagged: "+x.flags.join(", "),"s-err");
          });
          return;
        }
        if(first==="fail") throw {code:"tool_error",server:HF,message:"Couldn't download or finish the renders: "+out.split("\n").slice(1).join(" ").slice(-300)};
        if(n>=3) throw {code:"server_unavailable",server:HF,message:"Finishing took too long."};
        return poll(n+1);
      });
    }
    return sh(build,true).then(function(){ return poll(1); });
  }
  function readImage(box,x){
    var parts=[], o=0, f=box.dir+"/"+x.file+".b64";
    function next(){
      if(o>=x.len) return Promise.resolve(parts.join(""));
      var cmd="tail -c +"+(o+1)+" "+f+" | head -c "+PIECE+"; tail -c +"+(o+PIECE+1)+" "+f+" | head -c "+PIECE+" >&2";
      return sh(cmd,false,30).then(function(p){
        var a=String(p.stdout||""), b=String(p.stderr||"");
        var want=Math.min(2*PIECE, x.len-o);
        if(p.truncated || (a.length+b.length)!==want || !/^[A-Za-z0-9+\/=]*$/.test(a+b))
          throw {code:"tool_error",server:HF,message:"A piece of the "+x.dims+" image came back incomplete."};
        parts.push(a,b); o+=want;
        return next();
      });
    }
    return next();
  }
  // A blank placeholder shape painted where the logo goes can't be hidden behind the logo:
  // Higgsfield repaints just that box once.
  function repaint(list){
    var reqs=list.map(function(x,i){
      var L=x.logo, z=L.zone;
      return {index:40+i+(RUN.pass++)*10, params:{model:"nano_banana_pro",aspect_ratio:ARFOR[x.kind],resolution:"2k",count:1,use_unlim:false,
        medias:[{value:x.job,role:"image_references"}],
        prompt:"Edit this advertisement only where described. Near "+L.where+", in the box from "+z[0]+"% to "+z[2]+"% of the frame width and "+z[1]+"% to "+z[3]+"% of the frame height, there is a blank, flat, pale shape painted over the photograph. Remove it completely and continue the photograph naturally through that area — the same scene, surfaces, lighting and grain as around it, calm and fairly dark. Change nothing else at all: every word, the typography, the layout, the colours, the panels, the button, the product and the rest of the photograph stay exactly as they are. Do not add any logo, wordmark, lettering, shape or badge anywhere.\n\nresolution: 2k"}};
    });
    return submitBatch(reqs)
    .then(function(jobs){ RUN.credits+=CREDITS_PER_RENDER*jobs.length; return waitJobs(jobs.map(function(j){return {index:j.index,job_id:j.job_id}})).then(function(done){ return {jobs:jobs,done:done}; }); })
    .then(function(r){
      list.forEach(function(x,i){
        x.repaired=true;
        var j=firstUrl(r.done,reqs[i].index);
        if(j&&j.status==="completed"&&j.result_url){ x.url=j.result_url; x.job=j.job_id; log("  "+x.dims+" repainted.","s-ok"); }
        else log("  "+x.dims+" couldn’t be repainted — keeping the original.","s-err");
      });
    });
  }
  function finishItems(items){
    var box=null;
    items.forEach(function(x){ x.state="finishing"; paintCard(x); });
    log("Finishing "+items.map(function(x){return x.dims}).join(", ")+" — exact size, brand colour, logo…");
    return prepSandbox()
    .then(function(b){ box=b; return finishPass(box,items); })
    .then(function(){
      var bad=items.filter(function(x){ return x.flags.indexOf("PLACEHOLDER")>-1 && !x.repaired && x.job; });
      if(!bad.length) return;
      log("Repainting the blank patch in "+bad.map(function(x){return x.dims}).join(", ")+" ("+CREDITS_PER_RENDER+" credits each)…");
      return repaint(bad).then(function(){ return finishPass(box,bad); });
    })
    .then(function(){
      return items.reduce(function(pr,x){
        return pr.then(function(){
          if(!x.len) throw {code:"tool_error",server:HF,message:"The "+x.dims+" file wasn't produced."};
          return readImage(box,x).then(function(b64){ x.b64=b64; x.state="done"; paintCard(x); });
        });
      },Promise.resolve());
    })
    .then(function(){ dropSandbox(box); }, function(e){ dropSandbox(box); items.forEach(function(x){ if(!x.b64){ x.state="failed"; paintCard(x); } }); throw e; });
  }

  // ---------- output cards ----------
  var FLAGTXT={
    COLLISION:"Artwork runs into the logo zone, so the logo overlaps it. Regenerate this size; don't use this file as is.",
    PLACEHOLDER:"A blank patch is still visible behind the logo after repainting. Regenerate this size.",
    CONTRAST:"The background under the logo was too light or dark for this template's lockup, so the other colourway was used. Check it against the other sizes.",
    "BUBBLE?":"Couldn't find the white speech bubble, so the logo is at the grid default. Check that it sits inside the bubble.",
    SAFEZONE:"The logo is in the top 14%, where the Stories/Reels header covers it (the bubble was drawn too high). Regenerate this size.",
    NOCTA:"No solid gold button was found. The generator may have drawn it in another colour or left it out. Regenerate this size.",
    CTACOLOR:"The button is too far from HitLights gold (#EBA800) to correct. Regenerate this size.",
    FIELDCOLOR:"The brand background drifted off the palette. Compare it with the other sizes before using it."
  };
  function b64ToBlob(b64){
    var bin=atob(b64), n=bin.length, u=new Uint8Array(n);
    for(var i=0;i<n;i++) u[i]=bin.charCodeAt(i);
    return new Blob([u],{type:"image/jpeg"});
  }
  function fileName(x){ return x.dims+(x.version>1?"-v"+x.version:"")+".jpg"; }
  function itemOf(kind){ return RUN&&RUN.items.filter(function(x){ return x.kind===kind; })[0]; }
  function el(tag,cls,text){ var e=document.createElement(tag); if(cls) e.className=cls; if(text!=null) e.textContent=text; return e; }
  function paintCard(x){
    var c=el("div","outcard"); c.id="card-"+x.kind;
    c.appendChild(el("b",null,x.title+" — "+x.dims.replace("x"," × ")+(x.version>1?" · v"+x.version:"")));
    var st={waiting:"Waiting for the square master…", rendering:"Rendering…", rendered:"Rendered. Finishing comes next.",
      finishing:"Finishing: exact size, brand colour, logo…", failed:"This size didn’t finish. See the status log."}[x.state];
    if(x.state==="done"){
      var ok=!x.flags.filter(function(f){ return f!=="TEXT"; }).length;
      c.appendChild(el("span","dim","Exact size · logo on the Logo Grid at ("+(x.mode.match(/at \((\d+,\d+)\)/)||[0,x.logo.x+","+x.logo.y])[1]+")"+(ok?"":" · check the notes below")));
      var img=el("img"); img.src="data:image/jpeg;base64,"+x.b64; img.alt=x.title+" ad"; c.appendChild(img);
      x.flags.forEach(function(f){ var t=FLAGTXT[f]; if(t){ var w=el("div","err",t); w.style.marginTop="4px"; c.appendChild(w); } });
      var q=el("div","qa");
      if(!x.qa) q.textContent="Text & logo check: waiting…";
      else if(x.qa.state==="running") q.textContent="Text & logo check: Claude is reading the image…";
      else if(x.qa.state==="pass"){ q.textContent="Text & logo check: passed — every line matches, no stray text or logos."; q.classList.add("pass"); }
      else if(x.qa.state==="fail"){
        q.classList.add("fail"); q.appendChild(el("b",null,"Text & logo check: failed"));
        var ul=el("ul"); (x.qa.issues.length?x.qa.issues:["Claude marked it as failing without detail — look it over."]).forEach(function(i){ ul.appendChild(el("li",null,i)); }); q.appendChild(ul);
      }
      else if(x.qa.state==="off") q.textContent="Text & logo check: not available in this view — read the image over yourself.";
      else { q.textContent="Text & logo check: couldn’t run ("+(x.qa.code||"error")+"). "; var rb=el("button","linkbtn","Run it again"); rb.type="button"; rb.onclick=function(){ if(!busy) qaItems([x]); }; q.appendChild(rb); }
      c.appendChild(q);
      if(x.driveId) c.appendChild(el("span","dim","Saved to Drive as "+x.driveName));
      else if(x.held){
        var hd=el("div","dim","Held back from Drive until it\u2019s fixed. ");
        var sa=el("button","linkbtn","Save to Drive anyway"); sa.type="button";
        sa.onclick=function(){ if(busy) return; setBusy(true); driveSave([x],true).then(function(){ logRun(); setBusy(false); RUN.items.forEach(paintCard); }); };
        hd.appendChild(sa); c.appendChild(hd);
      }
    } else if(st){ c.appendChild(el("span","dim",st)); }
    var row=el("div","rowbtn");
    if(x.state==="done"&&dl){
      var btn=el("button","btn-quiet","Download "+fileName(x)); btn.type="button";
      var note=el("span","hint");
      btn.onclick=function(){
        btn.disabled=true;
        dl.save({filename:fileName(x),data:b64ToBlob(x.b64)}).then(function(){ note.textContent="Saved."; },function(e){
          note.textContent=(e&&e.code)==="declined"?"Download cancelled.":"Couldn’t download that file.";
        }).then(function(){ btn.disabled=false; });
      };
      row.appendChild(btn); row.appendChild(note);
    }
    if((x.state==="done"||x.state==="failed")&&RUN&&RUN.masterJob){
      var rg=el("button","btn-quiet", x.kind==="master" ? "Regenerate the whole set ("+3*CREDITS_PER_RENDER+" credits)" : "Regenerate this size ("+CREDITS_PER_RENDER+" credits)");
      rg.type="button"; rg.disabled=busy; rg.className+=" regen";
      rg.onclick=function(){ regen(x.kind); };
      row.appendChild(rg);
    }
    if(x.url){ var a=el("a","hint","raw render ↗"); a.href=x.url; a.target="_blank"; a.rel="noopener noreferrer"; row.appendChild(a); }
    if(row.childNodes.length) c.appendChild(row);
    var old=$("card-"+x.kind); if(old) old.replaceWith(c); else outEl.appendChild(c);
  }
  function setBusy(b){
    busy=b; $("go").disabled=b; $("go").textContent=b?"Working…":"Generate the three sizes";
    Array.prototype.forEach.call(document.querySelectorAll(".regen"),function(r){ r.disabled=b; });
  }

  // ---------- text & logo check (Claude reads the finished images) ----------
  function qaPrompt(group){
    var S=RUN.S, E=S.expect, L=[];
    L.push("You are the final quality check on HitLights paid-social ads before they run. You are given "+group.length+" finished ad image"+(group.length>1?"s":"")+", in this order: "+group.map(function(x,i){ return (i+1)+") "+x.dims+" "+x.title.toLowerCase(); }).join(", ")+".");
    L.push("");
    L.push("EXPECTED TEXT — the only words that may appear (case and punctuation may differ slightly, and a line may wrap):");
    if(E.h1) L.push("- Headline line 1: \""+E.h1+"\"");
    if(E.h2) L.push("- Headline line 2: \""+E.h2+"\"");
    if(E.sub) L.push("- Subheadline: \""+E.sub+"\"");
    E.proof.forEach(function(p,i){ L.push("- Proof point "+(i+1)+": \""+p+"\""); });
    if(E.deadline) L.push("- Deadline line: \""+E.deadline+"\"");
    if(E.cta) L.push("- Button: \""+E.cta+"\" (a small arrow after it is fine)");
    group.forEach(function(x){ var c=E.contact[x.kind]||[]; L.push("- Contact on the "+x.dims+" image: "+(c.length?c.map(function(s){return "\""+s+"\"";}).join(" and ")+" (small icons beside them are fine)":"none")); });
    L.push("Words printed on the physical product itself (model numbers, labels) are allowed. A trust seal may repeat one proof point word for word.");
    L.push("");
    L.push("THE LOGO: the real HitLights logo — an H mark followed by the word HITLIGHTS and ® — was placed deliberately: "+group.map(function(x){ return "on the "+x.dims+" image at "+x.logo.where; }).join("; ")+". That one logo is correct.");
    L.push("");
    L.push("FAIL an image if any of these is true:");
    L.push("1. An expected line is missing, misspelled, has letters missing, extra or swapped, or is garbled.");
    L.push("2. Any other text appears that is not expected: invented words, gibberish, duplicated lines, stray letters, a price, percentage or date that is not listed.");
    L.push("3. A second HitLights logo, the brand name or a wordmark is drawn anywhere else, or any other brand's logo appears.");
    L.push("4. Text, the product or other artwork overlaps or touches the placed HitLights logo.");
    L.push("5. Text is cut off by the edge of the frame.");
    L.push("Otherwise PASS. Be strict about spelling. Ignore photo realism and design taste.");
    L.push("");
    L.push("Reply with only JSON: {\"images\":[{\"size\":\"1080x1080\",\"verdict\":\"pass\",\"issues\":[]}]} — one entry per image in the order given; verdict is \"pass\" or \"fail\"; issues are short, specific problems (quote the wrong text), empty when it passes.");
    return L.join("\n");
  }
  function qaItems(items){
    items=items.filter(function(x){ return x.b64; });
    if(!items.length) return Promise.resolve();
    if(!sample||!imgCaps){ items.forEach(function(x){ x.qa={state:"off"}; paintCard(x); }); return Promise.resolve(); }
    var per=Math.max(1,Math.min(imgCaps.maxCount||1,3)), groups=[];
    for(var i=0;i<items.length;i+=per) groups.push(items.slice(i,i+per));
    log("Checking text and logo with Claude…");
    return groups.reduce(function(pr,g){ return pr.then(function(){ return qaGroup(g); }); },Promise.resolve())
      .then(function(){ logRun(); });
  }
  function qaGroup(g){
    g.forEach(function(x){ x.qa={state:"running"}; paintCard(x); });
    return sample.json(qaPrompt(g),{images:g.map(function(x){ return b64ToBlob(x.b64); }),modelTier:"default",cache:false})
    .then(function(o){
      var arr=(o&&o.images)||[];
      g.forEach(function(x,i){
        var r=arr[i]||{};
        var issues=(Array.isArray(r.issues)?r.issues:[]).map(String).filter(Boolean).slice(0,8);
        var pass=String(r.verdict||"").toLowerCase()==="pass";
        x.qa={state:pass?"pass":"fail",issues:issues};
        x.flags=x.flags.filter(function(f){ return f!=="TEXT"; }); if(!pass) x.flags.push("TEXT");
        log("  "+x.dims+" text & logo check: "+(pass?"passed":"failed — "+issues.join("; ")), pass?"s-ok":"s-err");
        paintCard(x);
      });
    },function(e){
      var c=e&&e.code, off=(c==="not_granted"||c==="images_unavailable"||c==="sampling_disabled"||c==="not_declared"||c==="capability_disabled"||c==="capability_removed");
      g.forEach(function(x){ x.qa={state:off?"off":"error",code:c}; paintCard(x); });
    });
  }

  // ---------- Google Drive ----------
  function driveStatus(text,link,retry){
    driveEl.innerHTML="";
    var c=el("div","outcard"); c.appendChild(el("b",null,"Google Drive")); c.appendChild(el("span","dim",text));
    if(link){ var a=el("a",null,"Open the Drive folder ↗"); a.href=link; a.target="_blank"; a.rel="noopener noreferrer"; c.appendChild(a); }
    if(retry){ var b=el("button","btn-quiet","Try saving to Drive again"); b.type="button"; b.style.justifySelf="start"; b.onclick=function(){ if(!busy) driveSave(RUN.items); }; c.appendChild(b); }
    driveEl.appendChild(c);
  }
  // Only clean files go to Drive, so the folder never holds one that shouldn't run. A file with a
  // blocking flag is held back; its card offers "Save to Drive anyway".
  var BLOCKING=["COLLISION","PLACEHOLDER","SAFEZONE","NOCTA","CTACOLOR","TEXT"];
  function blocked(x){ return x.flags.filter(function(f){ return BLOCKING.indexOf(f)>-1; }); }
  function driveSummary(){
    var saved=RUN.items.filter(function(x){return x.driveId}).map(function(x){return x.driveName});
    var held=RUN.items.filter(function(x){return x.held&&!x.driveId}).map(function(x){return x.dims});
    return RUN.S.folder+" \u2014 "+(saved.length?saved.join(", "):"nothing saved yet")+(held.length?". Held back until fixed: "+held.join(", ")+".":"");
  }
  function driveSave(items,force){
    if(!$("saveDrive").checked){ driveStatus("Not saved to Drive (turned off). Use the download buttons."); return Promise.resolve(); }
    items=items.filter(function(x){ return x.b64&&!x.driveId; });
    items.forEach(function(x){ x.held=!force&&blocked(x).length>0; if(x.held) paintCard(x); });
    items=items.filter(function(x){ return !x.held; });
    if(!items.length){ if(RUN.items.some(function(x){return x.held})) driveStatus(driveSummary(),RUN.folder&&RUN.folder.url); return Promise.resolve(); }
    driveStatus("Saving to “"+RUN.S.folder+"”…");
    var f=RUN.folder ? Promise.resolve(RUN.folder)
      : mcp.callTool(GD,"create_file",{title:RUN.S.folder,contentMimeType:"application/vnd.google-apps.folder",parentId:DRIVE_PARENT},{cache:false}).then(function(r){
          var p=(r&&r.payload)||{}, id=p.id||(p.file&&p.file.id)||"";
          if(!id) throw {code:"tool_error",server:GD,message:"Drive didn't return an ID for the new folder."};
          RUN.folder={id:id,url:p.viewUrl||(p.file&&p.file.viewUrl)||("https://drive.google.com/drive/folders/"+id)};
          return RUN.folder;
        });
    return f.then(function(folder){
      return items.reduce(function(pr,x){
        return pr.then(function(){
          return mcp.callTool(GD,"create_file",{title:fileName(x),parentId:folder.id,base64Content:x.b64,contentMimeType:"image/jpeg",disableConversionToGoogleType:true},{cache:false})
          .then(function(r){ var p=(r&&r.payload)||{}; x.driveId=p.id||(p.file&&p.file.id)||"saved"; x.driveName=fileName(x); x.held=false; paintCard(x); log("  "+fileName(x)+" saved to Drive.","s-ok"); });
        });
      },Promise.resolve());
    }).then(function(){
      driveStatus(driveSummary(),RUN.folder.url);
      logRun();
    },function(e){
      var x=explain(e);
      driveStatus("Not saved: "+x[0]+" — "+x[1],RUN.folder&&RUN.folder.url,true);
      log("Drive save failed — "+x[0]+".","s-err");
    });
  }

  // ---------- run log (this page's own store) ----------
  function logRun(){
    if(!db||!RUN) return;
    var sizes={};
    RUN.items.forEach(function(x){ sizes[x.dims]={version:x.version||1, state:x.state||"", flags:(x.flags||[]).slice(), qa:x.qa?x.qa.state:"", issues:(x.qa&&x.qa.issues)||[], file:x.driveName||""}; });
    var doc={ts:RUN.ts, product:RUN.S.product||"", template:RUN.S.tplName, tpl:RUN.S.tpl, sizes:sizes, folderUrl:RUN.folder?RUN.folder.url:"", credits:RUN.credits};
    var id=RUN.id;
    RUN.logQ=(RUN.logQ||Promise.resolve()).then(function(){ return db.doc("runs/"+id).set(doc); }).catch(function(){});
  }
  function watchRuns(){
    var box=$("runs"), card=$("runsCard"); if(!db||!box) return;
    card.hidden=false;
    db.collection("runs").orderBy("ts","desc").limit(12).onSnapshot(function(snap){
      box.innerHTML="";
      if(snap.empty){ box.appendChild(el("p","hint","No sets yet. Each set you generate is logged here with its checks and Drive link.")); return; }
      var t=el("table","runs");
      var h=el("tr"); ["When","Product","Template","1080×1080","1080×1920","1200×628",""].forEach(function(s){ h.appendChild(el("th",null,s)); }); t.appendChild(h);
      snap.docs.forEach(function(d){
        var r=d.data()||{}, tr=el("tr");
        var dt=new Date(r.ts||0);
        tr.appendChild(el("td",null,dt.toLocaleDateString(undefined,{month:"short",day:"numeric"})+" "+dt.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"})));
        tr.appendChild(el("td",null,String(r.product||"—")));
        tr.appendChild(el("td",null,String(r.template||"").replace(/^Template (\d) — /,"T$1 ")));
        ["1080x1080","1080x1920","1200x628"].forEach(function(k){
          var s=(r.sizes||{})[k]||{}, fl=(s.flags||[]), td=el("td");
          var ok=s.state==="done"&&!fl.length&&s.qa==="pass";
          var tag=el("span","chip "+(ok?"ok":(s.state==="done"?"warn":"bad")));
          tag.textContent=ok?"clean":(s.state!=="done"?(s.state||"—"):(fl.length?fl.join(" "):(s.qa==="pass"?"clean":"unchecked")));
          if(s.version>1) tag.textContent+=" · v"+s.version;
          td.appendChild(tag); tr.appendChild(td);
        });
        var lk=el("td"); if(r.folderUrl){ var a=el("a",null,"Drive ↗"); a.href=String(r.folderUrl); a.target="_blank"; a.rel="noopener noreferrer"; lk.appendChild(a); } tr.appendChild(lk);
        t.appendChild(tr);
      });
      var wrap=el("div","tblwrap"); wrap.appendChild(t); box.appendChild(wrap);
    },function(){ card.hidden=true; });
  }

  // ---------- run a set ----------
  function startRun(S){
    setBusy(true);
    outEl.innerHTML=""; driveEl.innerHTML=""; logEl.textContent=""; logEl.dataset.fresh="1";
    RUN={id:"r"+Date.now(), ts:Date.now(), S:S, credits:0, pass:0, folder:null, productId:null, masterJob:null,
      items:KINDS.map(function(k){ return {kind:k, dims:CANVAS[k].dims, title:CANVAS[k].title, logo:S.logo[k], version:1, flags:[], state:k==="master"?"rendering":"waiting"}; })};
    RUN.items.forEach(paintCard);
    log("Settings captured — edits from here on won't affect this set.");
    log("Importing the product image…");
    var M=itemOf("master"), P=itemOf("portrait"), Ls=itemOf("landscape");
    return mcp.callTool(HF,"media_import_url",{url:S.url,type:"image"},{cache:false})
    .then(function(r){
      var id=r&&r.payload&&r.payload.media_id;
      if(!id) throw {code:"tool_error",server:HF,message:"The image URL couldn't be imported. It must be a direct, publicly reachable image link."};
      RUN.productId=id; log("Image imported.","s-ok");
      log("Rendering the square master…");
      return renderOne("master");
    })
    .then(function(j){
      M.url=j.result_url; M.job=j.job_id; RUN.masterJob=j.job_id; M.state="rendered"; paintCard(M);
      log("Square master done. Building portrait and landscape from it…","s-ok");
      P.state="rendering"; Ls.state="rendering"; paintCard(P); paintCard(Ls);
      var reqs=[renderReq("portrait",2),renderReq("landscape",3)];
      return submitBatch(reqs).then(function(jobs){ RUN.credits+=CREDITS_PER_RENDER*jobs.length; return waitJobs(jobs.map(function(j){return {index:j.index,job_id:j.job_id}})); });
    })
    .then(function(done){
      [[P,2],[Ls,3]].forEach(function(pair){
        var x=pair[0], j=firstUrl(done,pair[1]);
        if(j&&j.status==="completed"&&j.result_url){ x.url=j.result_url; x.job=j.job_id; x.state="rendered"; }
        else { x.state="failed"; log("The "+x.title.toLowerCase()+" render didn't finish — use Regenerate this size.","s-err"); }
        paintCard(x);
      });
      if(S.outOfStock) log("Reminder: the product you picked has zero inventory.","s-err");
      return finishItems(RUN.items.filter(function(x){ return x.url; }));
    })
    .then(function(){
      log("Finished files ready.","s-ok");
      var ready=RUN.items.filter(function(x){ return x.b64; });
      return qaItems(ready).then(function(){ return driveSave(ready); });
    })
    .catch(function(e){ var x=explain(e); log(x[0]+" — "+x[1],"s-err"); fail(x[0],x[1]); })
    .then(function(){ logRun(); refreshBalance(); setBusy(false); RUN.items.forEach(paintCard); });
  }
  function regen(kind){
    if(busy||!RUN) return;
    if(kind==="master"){
      var n=(RUN.setNo||1)+1, S2={}; for(var k in RUN.S) S2[k]=RUN.S[k];
      S2.folder=RUN.S.folder.replace(/ \(set \d+\)$/,"")+" (set "+n+")";
      startRun(S2); RUN.setNo=n; return;
    }
    var x=itemOf(kind); if(!x) return;
    setBusy(true);
    x.version=(x.version||1)+1; x.state="rendering"; x.b64=null; x.qa=null; x.flags=[]; x.repaired=false; x.driveId=null; x.driveName=null; x.mode="";
    paintCard(x);
    log("Regenerating the "+x.title.toLowerCase()+" from the same master…");
    renderOne(kind)
    .then(function(j){ x.url=j.result_url; x.job=j.job_id; x.state="rendered"; paintCard(x); return finishItems([x]); })
    .then(function(){ return qaItems([x]).then(function(){ return driveSave([x]); }); })
    .catch(function(e){ var r=explain(e); log(r[0]+" — "+r[1],"s-err"); if(x.state!=="done"){ x.state="failed"; } })
    .then(function(){ logRun(); refreshBalance(); setBusy(false); RUN.items.forEach(paintCard); });
  }

  // Remember the Drive checkbox per viewer (a convenience only; the page works without storage).
  try{ var sd=localStorage.getItem("hl-save-drive"); if(sd!==null) $("saveDrive").checked=(sd==="1"); }catch(e){}
  $("saveDrive").addEventListener("change",function(){ try{ localStorage.setItem("hl-save-drive",$("saveDrive").checked?"1":"0"); }catch(e){} });

  function todayStr(){
    var d=new Date(), p=function(n){return (n<10?"0":"")+n};
    return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate());
  }
  function folderName(){
    var nm=(picked&&(picked.title||picked.label))||"Untitled product";
    if(/^https?:\/\//i.test(nm)) nm="Untitled product";
    nm=nm.replace(/[\\\/:*?"<>|]+/g,"-").replace(/\s+/g," ").trim().slice(0,120);
    return todayStr()+" "+nm;
  }

  $("go").addEventListener("click", function(){
    if(busy) return;
    outEl.innerHTML="";
    if(!mcp){
      fail("Higgsfield isn't connected to your Claude",
        "Generating bills to whoever runs it, so it needs the Higgsfield connector on your own account. See the banner at the top of the page for the steps — or press Build the prompt pack, which needs no connectors at all.");
      try{ window.scrollTo({top:0,behavior:"smooth"}); }catch(e){}
      return;
    }
    if(!picked||!picked.url){ fail("Pick a product image first","Search the catalog and choose a product, or paste a public image URL."); return; }
    if(!$("h1").value.trim()&&!$("h2").value.trim()){ fail("Write a headline","At least one headline line is needed."); return; }
    if(curTpl().deadline && (!$("h1").value.trim() || !$("deadline").value.trim())){ fail("Add the offer and deadline","Template 3 needs the offer line (e.g. 11% OFF) and the deadline line. Use only a real, approved offer."); return; }
    if(!$("cta").value.trim()){ fail("Write the button","The CTA is required."); return; }
    var bad=checkLimits();
    if(bad.length){ fail("The copy doesn’t fit this template",bad.join(". ")+". Long copy is what makes the generator shrink, wrap or misspell text."); return; }
    if(balance!=null && balance<3*CREDITS_PER_RENDER){ fail("Not enough Higgsfield credits","A set needs "+3*CREDITS_PER_RENDER+" credits and the balance is "+fmtCredits(balance)+". Top up Higgsfield, then press Generate again."); return; }
    startRun(snapshot());
  });

  // ---------- prompt pack (works with no connectors at all) ----------
  function packText(){
    var src = (picked && picked.url) ? picked.url : "";
    var name = (picked && picked.label) ? picked.label : "";
    var L = [];
    L.push("HITLIGHTS AD BUILDER " + DASH + " PROMPT PACK");
    L.push("Built " + new Date().toISOString().slice(0,10) + " to the Andromeda spec: one image ad, three sizes, one concept.");
    L.push("");
    L.push("HOW TO RUN THIS: paste the whole of this message into a Claude chat that has the Higgsfield");
    L.push("connector, or hand it to someone who does. Work through the three steps in order " + DASH + " step 2");
    L.push("and step 3 must reference the finished render from step 1, not the original product photo.");
    L.push("");
    L.push("TEMPLATE: " + curTpl().pillar + " " + DASH + " " + curTpl().name);
    L.push("PRODUCT: " + (name || "(not chosen in the builder)"));
    L.push("PRODUCT IMAGE: " + (src || "(none " + DASH + " attach the product photo to the chat instead)"));
    L.push("");
    L.push("=".repeat(78));
    L.push("STEP 1 " + DASH + " SQUARE MASTER");
    L.push("Import the product image with Higgsfield media_import_url, then generate_image_batch with:");
    L.push("  model nano_banana_pro | aspect_ratio 1:1 | resolution 2k | count 1");
    L.push("  medias: the imported media_id, role image_references");
    L.push("PROMPT:");
    L.push(prompt_("master"));
    L.push("");
    L.push("=".repeat(78));
    L.push("STEP 2 " + DASH + " PORTRAIT, BUILT FROM THE SQUARE");
    L.push("  model nano_banana_pro | aspect_ratio 9:16 | resolution 2k | count 1");
    L.push("  medias: the job_id of the finished square from step 1, then the imported product media_id, both role image_references");
    L.push("PROMPT:");
    L.push(prompt_("portrait"));
    L.push("");
    L.push("=".repeat(78));
    L.push("STEP 3 " + DASH + " LANDSCAPE, BUILT FROM THE SQUARE");
    L.push("  model nano_banana_pro | aspect_ratio 16:9 | resolution 2k | count 1");
    L.push("  medias: the job_id of the finished square from step 1, then the imported product media_id, both role image_references");
    L.push("PROMPT:");
    L.push(prompt_("landscape"));
    L.push("");
    L.push("=".repeat(78));
    L.push("FINISHING " + DASH + " exact size, brand colour, the real logo. Run these with Higgsfield sandbox_exec, back to back:");
    L.push("  K0 (background: true):  mkdir -p /home/user/hlkit && cd /home/user/hlkit && exec -a keep-hlkit sleep 900");
    L.push("  K1 (timeout_seconds 60) " + DASH + " send everything between the two ----- lines as ONE command. It downloads the");
    L.push("     official lockups from the HitLights Shopify CDN and writes finish.py. It must print \"ok 1179x166\".");
    L.push("-----");
    L.push(setupCmd("/home/user/hlkit"));
    L.push("-----");
    KINDS.forEach(function(k,i){
      var d=CANVAS[k].dims;
      L.push("  K"+(2+i)+" ("+d+"):  cd /home/user/hlkit && curl -sfL '<"+CANVAS[k].title.toLowerCase()+" render URL>' -o "+d+".src && convert "+d+".src -resize '"+d+"^' -gravity center -extent "+d+" "+d+".png && python3 finish.py "+d+".png "+d+".jpg '"+JSON.stringify(finishSpec(logoSpec(k)))+"'");
    });
    L.push("  Each K2–K4 prints a report; any FLAGS on it means check or regenerate that size. Bring each");
    L.push("  finished JPEG back with media_upload (PUT the file to its upload_url in the same command), then media_confirm.");
    L.push("");
    L.push("By hand (Logo Grid " + DASH + " top-left corner of the logo, in pixels on the finished file):");
    KINDS.forEach(function(k){
      var g=logoSpec(k);
      L.push("  "+CANVAS[k].dims+": x "+g.x+", y "+g.y+", "+g.w+" px wide, "+g.colour+" lockup"+(g.shadow?" with a soft shadow":"")+(g.ground==="bubble"?" (centred in the top of the bubble, "+g.pad+" px below its top edge)":""));
    });
    L.push("Nothing drawn behind it " + DASH + " no box, no scrim, no haze. Same position every time; never moved to find space.");
    L.push("Check them side by side before handover " + DASH + " same photograph, same wording, same colours.");
    L.push("The three files are one ad at three sizes, never three different designs.");
    return L.join("\n");
  }
  $("packbtn").addEventListener("click", function(){
    if(!$("h1").value.trim() && !$("h2").value.trim()){
      $("packhint").textContent = "Write at least one headline line first.";
      return;
    }
    var bad=checkLimits();
    if(bad.length){ $("packhint").textContent = "The copy doesn\u2019t fit this template: "+bad.join(". ")+"."; return; }
    $("packtext").value = packText();
    $("pack").hidden = false;
    $("packhint").textContent = "Built from the fields above. Rebuild it after any edit.";
    $("packcopied").textContent = "";
  });
  $("packcopy").addEventListener("click", function(){
    var t = $("packtext");
    function done(){ $("packcopied").textContent = "Copied."; }
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(t.value).then(done, function(){
        t.select(); $("packcopied").textContent = "Press Ctrl/Cmd+C to copy.";
      });
    } else {
      t.select(); $("packcopied").textContent = "Press Ctrl/Cmd+C to copy.";
    }
  });

  // ---------- brand kit reference (Logo Grid + the five templates at the three sizes) ----------
  // Rendered from the same LOGOGRID, CANVAS and LOGO data the pipeline uses, so the reference can
  // never drift from what the builder does. "Download" writes the same thing as a standalone file:
  // that file is HitLights Ad Templates.html in the vault.
  var KIT={"css": ".kit .cv{position:relative;overflow:hidden;border-radius:8px;container-type:inline-size;font-family:'Montserrat',Arial,sans-serif}\n.kit .cv.sq{aspect-ratio:1/1}\n.kit .cv.pt{aspect-ratio:9/16}\n.kit .cv.ls{aspect-ratio:1200/628}\n.kit .cv>*{position:absolute}\n.kit .ph{display:flex;align-items:center;justify-content:center;text-align:center;color:#fff;font-size:2.2cqw;font-weight:600;padding:2cqw;line-height:1.35}\n.kit .cv.ls .ph{font-size:1.3cqw}\n.kit .cv .logo{display:block;height:auto;z-index:5}\n.kit .cv .logo.shadow{filter:drop-shadow(0 .25cqw .5cqw rgba(0,0,0,.45))}\n.kit .lz{z-index:6;border:1.5px dashed #FF3B8D;background:rgba(255,59,141,.10);display:none;pointer-events:none}\n.kit.showzones .lz{display:block}\n.kit .safe{z-index:7;left:0;right:0;display:none;background:repeating-linear-gradient(135deg,rgba(255,0,0,.20) 0 6px,rgba(255,0,0,.06) 6px 12px);color:#fff;font-size:2.4cqw;font-weight:700;align-items:center;justify-content:center;text-shadow:0 1px 2px rgba(0,0,0,.6)}\n.kit.showsafe .cv.pt .safe{display:flex}\n.kit .safe.top{top:0;height:14%}\n.kit .safe.bot{bottom:0;height:20%}\n.kit .pill{background:var(--gold);color:var(--ink);font-weight:800;border-radius:999px;box-shadow:0 .4cqw 1cqw rgba(0,0,0,.25);white-space:nowrap}\n.kit .l1,.kit .l2{display:block}\n.kit ul.kpp{list-style:none;margin:0;padding:0}\n.kit ul.kpp li{display:flex;align-items:center;gap:.8em;margin-bottom:.35em}\n.kit ul.kpp li::before{content:\"\";width:.55em;height:.55em;border-radius:50%;background:var(--gold-bright);flex:none}\n.kit .t1{background:var(--purple)}\n.kit .t1 .dots{left:0;bottom:0;width:45%;height:35%;background-image:radial-gradient(var(--gold-bright) 22%,transparent 23%);background-size:2.6cqw 2.6cqw;opacity:.55}\n.kit .t1 .hd .l1{color:var(--gold-bright);font-weight:800;line-height:1.05}\n.kit .t1 .hd .l2{color:#fff;font-weight:700;line-height:1.1;margin-top:.2em}\n.kit .t1 .photo{background:linear-gradient(135deg,#8a7a5a,#4a4034);border-radius:1.2cqw}\n.kit .t1 .product{background:linear-gradient(160deg,var(--gold),#8a5a00);border-radius:50%;aspect-ratio:1;box-shadow:0 .8cqw 2.4cqw rgba(0,0,0,.35);z-index:2}\n.kit .t1 .seal{background:#fff;color:var(--purple);border-radius:50%;aspect-ratio:1;display:flex;align-items:center;justify-content:center;text-align:center;font-weight:800;box-shadow:0 .4cqw 1.2cqw rgba(0,0,0,.25);z-index:3}\n.kit .t1 .kpp{color:#fff;font-weight:600}\n.kit .t1 .ct{color:rgba(255,255,255,.85);font-weight:500;white-space:nowrap}\n.kit .t1.sq .hd{top:14%;left:5.93%;width:44%}\n.kit .t1.sq .l1{font-size:7.2cqw}\n.kit .t1.sq .l2{font-size:5cqw}\n.kit .t1.sq .kpp{top:33%;left:5.93%;width:30%;font-size:2.3cqw}\n.kit .t1.sq .photo{top:33%;right:6%;width:56%;height:42%}\n.kit .t1.sq .product{left:22%;top:54%;width:28%}\n.kit .t1.sq .seal{top:62%;right:8%;width:13%;font-size:1.5cqw}\n.kit .t1.sq .pill{bottom:9%;left:50%;transform:translateX(-50%);font-size:2.5cqw;padding:1.6cqw 4.4cqw}\n.kit .t1.sq .ct{bottom:3.6%;left:50%;transform:translateX(-50%);font-size:1.6cqw}\n.kit .t1.pt .hd{top:20%;left:5.93%;width:85%}\n.kit .t1.pt .l1{font-size:8.6cqw}\n.kit .t1.pt .l2{font-size:6cqw}\n.kit .t1.pt .photo{top:30.5%;left:6%;right:6%;height:26%}\n.kit .t1.pt .product{left:5%;top:47%;width:36%}\n.kit .t1.pt .seal{top:50%;right:9%;width:16%;font-size:1.8cqw}\n.kit .t1.pt .kpp{top:59%;left:45%;width:50%;font-size:3.1cqw}\n.kit .t1.pt .pill{top:70%;left:50%;transform:translateX(-50%);font-size:3.2cqw;padding:2cqw 5.4cqw}\n.kit .t1.pt .ct{top:76%;left:50%;transform:translateX(-50%);font-size:2.1cqw}\n.kit .t1.ls .hd{top:19%;left:4.67%;width:42%}\n.kit .t1.ls .l1{font-size:4.8cqw}\n.kit .t1.ls .l2{font-size:3.4cqw}\n.kit .t1.ls .kpp{top:46%;left:4.67%;width:36%;font-size:1.6cqw}\n.kit .t1.ls .pill{top:68%;left:4.67%;font-size:1.7cqw;padding:1.1cqw 3cqw}\n.kit .t1.ls .ct{top:84%;left:4.67%;font-size:1.1cqw}\n.kit .t1.ls .photo{left:50%;top:9%;right:4.67%;bottom:9%}\n.kit .t1.ls .product{left:41%;top:50%;width:16%}\n.kit .t1.ls .seal{bottom:14%;right:7%;width:8%;font-size:.9cqw}\n.kit .t1.ls .dots{left:36%;width:24%;height:46%}\n.kit .t2{background:linear-gradient(160deg,#a8b8c8,#465464)}\n.kit .t2 .bubble{background:#fff;border-radius:3cqw;box-shadow:0 1.2cqw 3.4cqw rgba(0,0,0,.25)}\n.kit .t2 .hd{text-align:center;color:var(--ink);font-weight:800;line-height:1.2}\n.kit .t2 .pl{text-align:center;color:var(--ink);font-weight:600;white-space:nowrap}\n.kit .t2 .product{background:rgba(255,255,255,.14);border:1px dashed rgba(255,255,255,.6);border-radius:1.6cqw}\n.kit .t2 .ct{color:rgba(255,255,255,.9);text-align:center;font-weight:500;text-shadow:0 1px 3px rgba(0,0,0,.5);white-space:nowrap}\n.kit .t2 .pill{transform:translateX(-50%)}\n.kit .t2.sq .bubble{top:4.44%;left:6%;right:6%;height:40%}\n.kit .t2.sq .hd{top:15.5%;left:6%;right:6%;font-size:4.6cqw}\n.kit .t2.sq .pl{top:29.5%;left:6%;right:6%;font-size:2cqw}\n.kit .t2.sq .pill{top:34.5%;left:50%;font-size:2.2cqw;padding:1.4cqw 3.8cqw}\n.kit .t2.sq .product{top:52%;bottom:10%;left:10%;right:10%}\n.kit .t2.sq .ct{bottom:3.5%;left:0;right:0;font-size:1.6cqw}\n.kit .t2.pt .bubble{top:14%;left:6%;right:6%;height:30%}\n.kit .t2.pt .hd{top:21%;left:6%;right:6%;font-size:5.6cqw}\n.kit .t2.pt .pl{top:31%;left:6%;right:6%;font-size:2.6cqw}\n.kit .t2.pt .pill{top:35.8%;left:50%;font-size:2.9cqw;padding:1.8cqw 5cqw}\n.kit .t2.pt .product{top:49%;bottom:27%;left:8%;right:8%}\n.kit .t2.pt .ct{top:76.5%;left:0;right:0;font-size:2.1cqw}\n.kit .t2.ls .bubble{left:4%;width:48%;top:7%;bottom:13%}\n.kit .t2.ls .hd{top:24%;left:4%;width:48%;font-size:3.1cqw}\n.kit .t2.ls .pl{top:52%;left:4%;width:48%;font-size:1.4cqw}\n.kit .t2.ls .pill{top:62%;left:28%;font-size:1.5cqw;padding:1cqw 2.8cqw}\n.kit .t2.ls .product{left:57%;right:4%;top:12%;bottom:16%}\n.kit .t2.ls .ct{bottom:4%;left:4%;width:48%;font-size:1.1cqw}\n.kit .t3{background:linear-gradient(200deg,#241a30,#120c18)}\n.kit .t3 .glow{background:radial-gradient(circle at 30% 40%,rgba(235,168,0,.35),transparent 60%),radial-gradient(circle at 70% 60%,rgba(103,81,133,.5),transparent 55%);filter:blur(2px)}\n.kit .t3 .hd .l1{color:var(--gold-bright);font-weight:800;line-height:1}\n.kit .t3 .hd .l2{color:#fff;font-weight:700;margin-top:.35em}\n.kit .t3 .flatlay{background:rgba(255,255,255,.08);border:1px dashed rgba(255,255,255,.4);border-radius:1.6cqw;transform:rotate(-6deg);color:#ddd}\n.kit .t3 .dl{color:#fff;font-weight:600;white-space:nowrap}\n.kit .t3 .btn{background:var(--gold);color:var(--ink);font-weight:800;border-radius:.9cqw;white-space:nowrap}\n.kit .t3.sq .glow{top:20%;left:10%;width:60%;height:45%}\n.kit .t3.sq .hd{top:20%;left:5.93%;right:20%}\n.kit .t3.sq .l1{font-size:13cqw}\n.kit .t3.sq .l2{font-size:4.4cqw}\n.kit .t3.sq .flatlay{right:5%;bottom:26%;width:52%;height:28%}\n.kit .t3.sq .dl{bottom:15.5%;left:5.93%;font-size:2.5cqw}\n.kit .t3.sq .btn{bottom:6.5%;left:5.93%;font-size:2.4cqw;padding:1.6cqw 4.2cqw}\n.kit .t3.pt .glow{top:32%;left:5%;width:90%;height:36%}\n.kit .t3.pt .hd{top:20%;left:5.93%;right:8%}\n.kit .t3.pt .l1{font-size:16cqw}\n.kit .t3.pt .l2{font-size:5.4cqw}\n.kit .t3.pt .flatlay{top:39%;left:9%;right:9%;height:21%}\n.kit .t3.pt .dl{top:65%;left:5.93%;font-size:3.3cqw}\n.kit .t3.pt .btn{top:70%;left:5.93%;font-size:3.2cqw;padding:2cqw 5.4cqw}\n.kit .t3.ls .glow{top:10%;left:45%;width:50%;height:80%}\n.kit .t3.ls .hd{top:18%;left:4.67%;width:45%}\n.kit .t3.ls .l1{font-size:7.6cqw}\n.kit .t3.ls .l2{font-size:2.6cqw}\n.kit .t3.ls .dl{top:56%;left:4.67%;font-size:1.6cqw}\n.kit .t3.ls .btn{top:67%;left:4.67%;font-size:1.6cqw;padding:1.1cqw 3cqw}\n.kit .t3.ls .flatlay{left:52%;right:5%;top:16%;bottom:18%}\n.kit .t4{background:var(--cream)}\n.kit .t4 .photo{background:linear-gradient(150deg,#b89272,#8f6a50 55%,#6e5040)}\n.kit .t4 .bar{background:var(--purple-light)}\n.kit .t4 .hd{color:var(--ink);font-weight:700;line-height:1.25}\n.kit .t4 .hd .hl{color:var(--gold)}\n.kit .t4 .seal{background:rgba(255,255,255,.92);color:var(--purple);border-radius:50%;aspect-ratio:1;display:flex;align-items:center;justify-content:center;text-align:center;font-weight:800;box-shadow:0 .4cqw 1.2cqw rgba(0,0,0,.2)}\n.kit .t4 .kpp{color:#3a3440;font-weight:500}\n.kit .t4 .ct{color:#6b6272;font-weight:500;white-space:nowrap}\n.kit .t4.sq .photo{top:0;left:0;right:0;height:60%;border-radius:0 0 3.4cqw 3.4cqw}\n.kit .t4.sq .seal{top:5.93%;right:6%;width:13%;font-size:1.4cqw}\n.kit .t4.sq .bar{left:0;top:60%;width:10%;height:40%}\n.kit .t4.sq .hd{top:63.5%;left:16%;right:8%;font-size:5cqw}\n.kit .t4.sq .kpp{top:77.5%;left:16%;font-size:1.9cqw}\n.kit .t4.sq .pill{bottom:4.5%;left:16%;font-size:2.1cqw;padding:1.4cqw 3.8cqw}\n.kit .t4.sq .ct{bottom:6%;right:6%;font-size:1.4cqw}\n.kit .t4.pt .photo{top:0;left:0;right:0;height:55%;border-radius:0 0 4cqw 4cqw}\n.kit .t4.pt .seal{top:15%;right:6%;width:15%;font-size:1.7cqw}\n.kit .t4.pt .bar{left:0;top:55%;width:10%;height:45%}\n.kit .t4.pt .hd{top:58%;left:16%;right:8%;font-size:6.6cqw}\n.kit .t4.pt .kpp{top:66.5%;left:16%;font-size:2.8cqw}\n.kit .t4.pt .pill{top:73.4%;left:16%;font-size:2.9cqw;padding:1.8cqw 5cqw}\n.kit .t4.pt .ct{top:78.3%;left:16%;font-size:1.9cqw}\n.kit .t4.ls .photo{top:0;left:0;bottom:0;width:55%;border-radius:0 3cqw 3cqw 0}\n.kit .t4.ls .seal{top:7.64%;left:44%;width:8%;font-size:.85cqw}\n.kit .t4.ls .bar{left:55%;top:0;bottom:0;width:2.6%}\n.kit .t4.ls .hd{top:15%;left:61%;right:4%;font-size:3.1cqw}\n.kit .t4.ls .kpp{top:42%;left:61%;font-size:1.35cqw}\n.kit .t4.ls .pill{top:64%;left:61%;font-size:1.4cqw;padding:1cqw 2.6cqw}\n.kit .t4.ls .ct{top:80%;left:61%;font-size:1cqw}\n.kit .t5{background:radial-gradient(ellipse at 50% 0%,rgba(255,176,90,.35),transparent 55%),linear-gradient(180deg,#2a211b,#15100d 70%)}\n.kit .t5 .cove{left:0;right:0;top:0;height:1.2%;background:linear-gradient(90deg,transparent,#FFC47A 20%,#FFC47A 80%,transparent);box-shadow:0 0 6cqw 2cqw rgba(255,176,90,.45)}\n.kit .t5 .hd{color:#fff;font-weight:800;line-height:1.05;text-shadow:0 .4cqw 1.4cqw rgba(0,0,0,.55)}\n.kit .t5 .sub{color:#fff;font-weight:400;line-height:1.35;text-shadow:0 .3cqw 1cqw rgba(0,0,0,.55)}\n.kit .t5 .product{background:radial-gradient(ellipse at 50% 50%,rgba(255,196,122,.9),rgba(235,168,0,.35) 45%,transparent 70%);border-radius:50%;color:#3a2a10}\n.kit .t5 .ct{color:#fff;font-weight:500;white-space:nowrap;text-shadow:0 1px 3px rgba(0,0,0,.6)}\n.kit .t5 .pill::after{content:\" \\2192\"}\n.kit .t5.sq .hd{top:12.5%;left:0;right:0;text-align:center;font-size:9cqw}\n.kit .t5.sq .sub{top:33%;left:22%;right:22%;text-align:center;font-size:3cqw}\n.kit .t5.sq .pill{top:43%;left:50%;transform:translateX(-50%);font-size:2.3cqw;padding:1.5cqw 4cqw}\n.kit .t5.sq .product{left:-8%;bottom:-14%;width:66%;height:48%}\n.kit .t5.sq .ct{right:5.93%;bottom:5.5%;text-align:right;font-size:1.6cqw;line-height:1.7}\n.kit .t5.pt .hd{top:19.5%;left:0;right:0;text-align:center;font-size:11cqw}\n.kit .t5.pt .sub{top:33.5%;left:14%;right:14%;text-align:center;font-size:3.8cqw}\n.kit .t5.pt .pill{top:41.5%;left:50%;transform:translateX(-50%);font-size:3cqw;padding:2cqw 5.2cqw}\n.kit .t5.pt .ct{top:47.3%;left:0;right:0;text-align:center;font-size:2.1cqw}\n.kit .t5.pt .product{left:-10%;right:-10%;top:64%;bottom:-6%}\n.kit .t5.ls .hd{top:17%;right:4.67%;text-align:right;font-size:5.2cqw}\n.kit .t5.ls .sub{top:57%;right:4.67%;width:36%;text-align:right;font-size:1.6cqw}\n.kit .t5.ls .pill{top:72%;right:4.67%;font-size:1.5cqw;padding:1cqw 2.8cqw}\n.kit .t5.ls .ct{display:none}\n.kit .t5.ls .product{left:-6%;bottom:-22%;width:52%;height:78%}", "tpls": [{"id": "t1", "tag": "Pillar A · Pro-Trust", "tagColor": "", "title": "Template 1 — Collage Hero", "markup": "<div class=\"dots\"><\/div> <div class=\"hd\"><span class=\"l1\">Pro-Graded<\/span><span class=\"l2\">LED Strip Lights<\/span><\/div> <ul class=\"kpp\"><li>UL Listed &amp; Class 2<\/li><li>100% to 0.3% dimming<\/li><li>6-year warranty<\/li><\/ul> <div class=\"photo ph\">LIFESTYLE PHOTO<br>staged interior, cool light<\/div> <div class=\"seal\">UL LISTED<\/div> <div class=\"product ph\">PRODUCT<br>glowing strip<\/div> <div class=\"pill\">Shop Now<\/div> <div class=\"ct\">+1 855 768 4135 · customerservice@hitlights.com<\/div>", "meta": "<b>Use for:<\/b> always-on brand/consideration, pro/installer audience · <b>Logo:<\/b> white, top-left, on the violet field; headline aligns to its left edge.", "caption": "<b>Caption formula:<\/b> value-prop line → 💡 3 bullet benefits → 🔗 Shop Now!"}, {"id": "t2", "tag": "Pillar A · Pro-Trust", "tagColor": "", "title": "Template 2 — Speech-Bubble Hero", "markup": "<div class=\"product ph\">PRODUCT FLATLAY<br>strip + remote + adapter<\/div> <div class=\"bubble\"><\/div> <div class=\"hd\">LED Kits Built<br>for the Job Site<\/div> <div class=\"pl\">UL Listed | Class 2 | 6-Yr Warranty<\/div> <div class=\"pill\">View Collection<\/div> <div class=\"ct\">+1 855 768 4135 · customerservice@hitlights.com<\/div>", "meta": "<b>Use for:<\/b> B2B/contractor prospecting, install/service angle · <b>Logo:<\/b> official violet lockup (#55426A), centred in the top of the white bubble (40 px below the bubble's top edge; 28 px on 1200×628). The Ad Builder finds the bubble in each render and centres on it.", "caption": "<b>Caption formula:<\/b> contractor trust line → features separated by \"|\" with emoji icons"}, {"id": "t3", "tag": "Pillar B · Promo Urgency", "tagColor": "", "title": "Template 3 — Discount Deadline", "markup": "<div class=\"glow\"><\/div> <div class=\"hd\"><span class=\"l1\">11% OFF<\/span><span class=\"l2\">LED Kits — Limited Time<\/span><\/div> <div class=\"flatlay ph\">PRODUCT FLATLAY<br>angled, ambient-lit room bg<\/div> <div class=\"dl\">Save 11% Before [date]<\/div> <div class=\"btn\">Shop Now<\/div>", "meta": "<b>Use for:<\/b> sales, retargeting, cart-abandonment, seasonal deadlines — audience-agnostic · <b>Logo:<\/b> white, top-left, same grid as Template 1.", "caption": "<b>Caption formula:<\/b> ⏳ urgency hook → bullets with emoji icons → 🚨 scarcity line → 🛒 Shop Now →"}, {"id": "t4", "tag": "Pillar C · Aesthetic Lifestyle", "tagColor": "#B8860B", "title": "Template 4 — Styled Room Hero", "markup": "<div class=\"photo ph\">LIFESTYLE PHOTO<br>warm, styled room — bedroom shelf / kitchen backsplash / vanity mirror<\/div> <div class=\"seal\">6-YR WARRANTY<\/div> <div class=\"bar\"><\/div> <div class=\"hd\">Your space,<br>your <span class=\"hl\">glow.<\/span><\/div> <ul class=\"kpp\"><li>Instant ambiance<\/li><li>Plug-and-play setup<\/li><li>6-year warranty<\/li><\/ul> <div class=\"pill\">Shop the Look<\/div> <div class=\"ct\">+1 855 768 4135 · customerservice@hitlights.com<\/div>", "meta": "<b>Use for:<\/b> prospecting to women 25–44 &amp; 18–34, interest-based targeting (home decor, interior design, DIY, room-tour content) — not trade/contractor targeting. See the brand kit doc for the ROAS data behind this recommendation. · <b>Logo:<\/b> white with a soft letterform shadow, top-left over a calm, darker corner of the photo. On 1080×1920 the photo is 55% tall (not 60%) so the CTA clears the bottom safe zone.", "caption": "<b>Caption formula:<\/b> mood-first hook → bullets lead with feeling before spec (✨ Instant ambiance → 🔌 Plug-and-play setup) → same gold-pill CTA line"}, {"id": "t5", "tag": "Pillar A · Pro-Trust", "tagColor": "", "title": "Template 5 — Glow Room Hero", "markup": "<div class=\"cove\"><\/div> <div class=\"product ph\">GLOWING PRODUCT<br>foreground, bleeds off edge<\/div> <div class=\"hd\">Built For<br>Professionals<\/div> <div class=\"sub\">Premium LED strips built for consistent performance<\/div> <div class=\"pill\">View Our Collection<\/div> <div class=\"ct\">+1 855 768 4135 ☎<br>customerservice@hitlights.com ✉<\/div>", "meta": "<b>Use for:<\/b> \"Built For Professionals\" pro-brand look — dark interior lit only by warm LED strip · <b>Logo:<\/b> white with soft shadow, top-centre over the photo on square and portrait; top-right on 1200×628, right edge flush with the right-aligned type block. Added to this reference Sept 25, 2026 to match the Ad Builder.", "caption": "<b>Caption formula (proposed — confirm against the “Built For Professionals” ad copy):<\/b> pro-trust claim line → ✔ 3 spec-led benefits → 🔗 View Our Collection →"}]};
  var KIT_UI_CSS=[
    ".kit{--purple:#523875;--purple-light:#675185;--gold:#EBA800;--gold-bright:#FBCA10;--ink:#232323;--cream:#FBF6EE;--blush:#F3E4DA}",
    ".kit{--k-surface:var(--surface,#fff);--k-line:var(--line,#E6E1EC);--k-text:var(--text,#232323);--k-dim:var(--text-dim,#666);--k-soft:var(--surface-2,#F6F3F9)}",
    ".kit .klead{font-size:14px;color:var(--k-dim);margin:0 0 14px;line-height:1.6}",
    ".kit .klock{display:flex;gap:12px;flex-wrap:wrap;margin:4px 0 16px}",
    ".kit .klock div{border-radius:8px;padding:12px 16px;display:flex;align-items:center;border:1px solid var(--k-line)}",
    ".kit .klock img{width:200px;display:block}",
    ".kit ul.krules{margin:0 0 16px;padding-left:18px;font-size:13.5px;line-height:1.65;color:var(--k-dim)}",
    ".kit ul.krules b{color:var(--k-text)}",
    ".kit .ktbl{overflow-x:auto;margin-bottom:6px}",
    ".kit table.kspec{border-collapse:collapse;width:100%;font-size:12.5px;min-width:720px}",
    ".kit table.kspec th,.kit table.kspec td{padding:7px 9px;border-bottom:1px solid var(--k-line);text-align:left;vertical-align:top;color:var(--k-text)}",
    ".kit table.kspec th{font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--k-dim);background:var(--k-soft)}",
    ".kit table.kspec code{font-family:ui-monospace,Menlo,monospace;font-size:11.5px}",
    ".kit .ktog{display:flex;gap:18px;flex-wrap:wrap;font-size:13px;font-weight:600;margin:12px 0 4px;color:var(--k-text)}",
    ".kit .ktog label{display:flex;gap:7px;align-items:center;cursor:pointer;font-family:inherit;text-transform:none;letter-spacing:0;font-size:13px;color:var(--k-text);margin:0}",
    ".kit .kcard{border-top:1px solid var(--k-line);padding:18px 0 6px;margin-top:14px}",
    ".kit .kcard h3{font-size:15px;font-weight:800;margin:0 0 2px;color:var(--k-text)}",
    ".kit .ktag{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#675185;margin-bottom:10px}",
    ".kit .sizes{display:grid;grid-template-columns:1fr .5625fr 1.911fr;gap:14px;align-items:start}",
    "@media (max-width:860px){.kit .sizes{grid-template-columns:1fr}.kit .sizes .col{max-width:420px}}",
    ".kit .col .dim{font-size:10.5px;font-weight:700;letter-spacing:.05em;color:var(--k-dim);margin-top:6px;font-family:inherit}",
    ".kit .kmeta{font-size:12.5px;color:var(--k-dim);margin-top:12px;line-height:1.6}",
    ".kit .kmeta b{color:var(--k-text)}",
    ".kit .kcap{margin-top:8px;font-size:12.5px;line-height:1.6;color:var(--k-dim);background:var(--k-soft);border-radius:6px;padding:9px 11px}",
    ".kit .kcap b{color:var(--k-text)}"
  ].join("\n");
  // Self-contained: the downloaded reference runs this same function with the same data.
  function kitBuild(root,cfg){
    var ORDER=["sq","pt","ls"];
    function lh(w){ return Math.round(w*84/600); }
    function h(tag,cls,html){ var e=document.createElement(tag); if(cls) e.className=cls; if(html!=null) e.innerHTML=html; return e; }
    root.innerHTML="";
    root.appendChild(h("p","klead","The logo lands on fixed pixel coordinates for each template and size — the same table the Ad Builder places it from. Photo and product zones below are labelled placeholders."));
    var lk=h("div","klock");
    [["white","#523875"],["black","#ffffff"],["violet","#ffffff"]].forEach(function(p){ var d=h("div"); d.style.background=p[1]; var i=h("img"); i.src=cfg.logos[p[0]]; i.alt="HitLights logo, "+p[0]+" lockup"; d.appendChild(i); lk.appendChild(d); });
    root.appendChild(lk);
    root.appendChild(h("ul","krules",[
      "<li><b>Real lockups only.</b> The official white and black lockups (HitLights Shopify CDN, with the ®), and the same lockup in logo violet #55426A (the Full-Logo-Purple colour) for the Template 2 bubble. Never redrawn, recoloured in any other colour, stretched, outlined, or put on a box, tab, scrim or badge.</li>",
      "<li><b>Fixed size per canvas, every template:</b> 280 px wide on 1080×1080 · 320 px on 1080×1920 · 240 px on 1200×628.</li>",
      "<li><b>Fixed position per template:</b> the coordinates below. The logo never moves to find space; the layout keeps its zone clear.</li>",
      "<li><b>Clear space:</b> 0.6× logo height on every side (the pink zone). No type, product, seal or photo detail inside it.</li>",
      "<li><b>9:16 safe zones:</b> nothing in the top 14% (Stories/Reels header) or bottom 20% (reply bar); the portrait logo sits at y = 288 px.</li>",
      "<li><b>Colourway fixed per template;</b> the builder swaps it only if the fixed one would be illegible, and flags the file.</li>"
    ].join("")));
    var rows="<tr><th>Template</th><th>Anchor</th><th>Lockup</th><th>Sits on</th>"+ORDER.map(function(k){ return "<th>"+cfg.canvas[k].label+" · x, y</th>"; }).join("")+"</tr>";
    Object.keys(cfg.grid).forEach(function(id){
      var g=cfg.grid[id];
      rows+="<tr><td><b>"+g.name+"</b></td><td>"+g.anchor+"</td><td>"+g.lockup+"</td><td>"+g.sits+"</td>"+ORDER.map(function(k){ var p=g.pos[k]; return "<td><code>"+p[0]+", "+p[1]+"</code> · "+cfg.canvas[k].w+"×"+lh(cfg.canvas[k].w)+"</td>"; }).join("")+"</tr>";
    });
    var tw=h("div","ktbl"); tw.appendChild(h("table","kspec",rows)); root.appendChild(tw);
    var tg=h("div","ktog",'<label><input type="checkbox" data-k="showzones"> Show logo zones</label><label><input type="checkbox" data-k="showsafe"> Show 9:16 safe zones</label>');
    Array.prototype.forEach.call(tg.querySelectorAll("input"),function(i){ i.addEventListener("change",function(){ root.classList.toggle(i.getAttribute("data-k"),i.checked); }); });
    root.appendChild(tg);
    cfg.tpls.forEach(function(t){
      var g=cfg.grid[t.id], card=h("div","kcard");
      var tag=h("div","ktag",t.tag); if(t.tagColor) tag.style.color=t.tagColor; card.appendChild(tag);
      card.appendChild(h("h3",null,t.title));
      var box=h("div","sizes");
      ORDER.forEach(function(k){
        var C=cfg.canvas[k], col=h("div","col"), cv=h("div","cv "+t.id+" "+k,t.markup);
        var x=g.pos[k][0], y=g.pos[k][1], w=C.w, hh=lh(w), pad=Math.round(hh*.6);
        var img=h("img","logo"+(g.shadow?" shadow":"")); img.alt="HitLights"; img.src=cfg.logos[g.colour];
        img.style.left=(x/C.W*100)+"%"; img.style.top=(y/C.H*100)+"%"; img.style.width=(w/C.W*100)+"%"; cv.appendChild(img);
        var z=h("div","lz"); z.style.left=((x-pad)/C.W*100)+"%"; z.style.top=((y-pad)/C.H*100)+"%"; z.style.width=((w+2*pad)/C.W*100)+"%"; z.style.height=((hh+2*pad)/C.H*100)+"%"; cv.appendChild(z);
        if(k==="pt"){ cv.appendChild(h("div","safe top","Top 14% — header")); cv.appendChild(h("div","safe bot","Bottom 20% — reply bar")); }
        col.appendChild(cv); col.appendChild(h("div","dim",C.label+" — logo at "+x+", "+y)); box.appendChild(col);
      });
      card.appendChild(box);
      card.appendChild(h("div","kmeta",t.meta));
      card.appendChild(h("div","kcap",t.caption));
      root.appendChild(card);
    });
  }
  function kitCfg(){
    var map={master:"sq",portrait:"pt",landscape:"ls"}, canvas={}, grid={};
    KINDS.forEach(function(k){ canvas[map[k]]={W:CANVAS[k].W,H:CANVAS[k].H,w:CANVAS[k].w,label:CANVAS[k].dims.replace("x","×")}; });
    var names={t1:"T1 Collage Hero",t2:"T2 Speech-Bubble",t3:"T3 Discount Deadline",t4:"T4 Styled Room",t5:"T5 Glow Room"};
    Object.keys(LOGOGRID).forEach(function(id){
      var G=LOGOGRID[id], pos={};
      KINDS.forEach(function(k){ pos[map[k]]=G.pos[k]; });
      var anchor=typeof G.a==="string"?({tl:"Top-left",bubble:"Top-centre of bubble"})[G.a]:"Top-centre (1200×628: top-right)";
      grid[id]={name:names[id], anchor:anchor, colour:G.colour, shadow:G.shadow, sits:G.sits, pos:pos,
        lockup:({white:"White",black:"Black",violet:"Violet (#55426A)"})[G.colour]+(G.shadow?" + soft shadow":"")};
    });
    return {logos:{white:"data:image/png;base64,"+LOGO.white, black:"data:image/png;base64,"+LOGO.black, violet:"data:image/png;base64,"+LOGO.violet}, canvas:canvas, grid:grid, tpls:KIT.tpls};
  }
  function renderKit(root){
    if(!root) return;
    var st=document.createElement("style"); st.textContent=KIT.css+"\n"+KIT_UI_CSS; document.head.appendChild(st);
    kitBuild(root,kitCfg());
    var b=$("kitdl");
    if(b) b.addEventListener("click",function(){
      var note=$("kitnote");
      if(!dl){ note.textContent="Downloads aren’t available in this view."; return; }
      dl.save({filename:"HitLights Ad Templates.html",data:kitExport()}).then(function(){ note.textContent="Saved — replace the copy in 20_Areas/Marketing."; },function(e){
        note.textContent=(e&&e.code)==="declined"?"Download cancelled.":"Couldn’t save that file.";
      });
    });
  }
  function kitExport(){
    var cfg=JSON.stringify(kitCfg()).replace(/</g,"\\u003c");
    var page=["*{box-sizing:border-box}",
      "body{margin:0;font-family:'Montserrat',Arial,sans-serif;background:#EDEDED;color:#232323;padding:40px 24px 80px}",
      ".wrap{max-width:1280px;margin:0 auto}",
      "header h1{font-size:28px;font-weight:800;margin:0 0 6px}",
      "header p{font-size:14px;color:#555;max-width:820px;line-height:1.6;margin:0 0 8px}",
      ".swatches{display:flex;gap:14px;flex-wrap:wrap;margin:24px 0 28px}",
      ".swatch{width:120px}.swatch .chip{height:64px;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.15)}",
      ".swatch .label{font-size:11px;margin-top:6px;font-weight:600}.swatch .hex{font-size:11px;color:#666}",
      ".kit{background:#fff;border-radius:12px;padding:22px;box-shadow:0 2px 10px rgba(0,0,0,.08)}",
      "footer{margin-top:40px;font-size:12px;color:#777;text-align:center}"].join("\n");
    var sw=[["#523875","Purple (deep)"],["#675185","Purple (primary)"],["#55426A","Logo violet"],["#EBA800","Gold (CTA)"],["#FBCA10","Gold (bright)"],["#232323","Ink"],["#FBF6EE","Cream"]]
      .map(function(s){ return '<div class="swatch"><div class="chip" style="background:'+s[0]+(s[0]==="#FBF6EE"?";border:1px solid #ddd":"")+'"></div><div class="label">'+s[1]+'</div><div class="hex">'+s[0]+'</div></div>'; }).join("");
    return "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n<title>HitLights Ad Templates</title>\n"+
      "<link href=\"https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap\" rel=\"stylesheet\">\n"+
      "<style>\n"+page+"\n"+KIT.css+"\n"+KIT_UI_CSS+"\n</style>\n</head>\n<body>\n<div class=\"wrap\">\n<header><h1>HitLights Ad Templates</h1>"+
      "<p>Visual reference built from HitLights' top-performing Meta ads (Sept 2026). Colors are pulled live from hitlights.com's theme, not estimated. Full write-up with the audience data behind Template 4 lives in <b>HitLights Ad Brand Kit.md</b>.</p>"+
      "<p><b>Generated by the HitLights Ad Builder on "+todayStr()+".</b> The Logo Grid below is the exact table the builder places the logo from. Change it in the builder, then download this file again.</p></header>\n"+
      "<div class=\"swatches\">"+sw+"</div>\n<div id=\"root\" class=\"kit\"></div>\n<footer>HitLights internal reference · not for external distribution</footer>\n</div>\n"+
      "<script>\n("+kitBuild.toString()+")(document.getElementById(\"root\"),"+cfg+");\n<\/script>\n</body>\n</html>\n";
  }

  // ---------- boot + access diagnosis ----------
  function gateShow(cls, title, paras, steps, tail, btn){
    var g=$("gate"); g.hidden=false; g.className="gate"+(cls?" "+cls:"");
    g.innerHTML="";
    var b=document.createElement("b"); b.textContent=title; g.appendChild(b);
    (paras||[]).forEach(function(t){ var p=document.createElement("p"); p.textContent=t; g.appendChild(p); });
    if(steps && steps.length){
      var ol=document.createElement("ol");
      steps.forEach(function(t){ var li=document.createElement("li"); var p=document.createElement("p");
        p.style.margin="0"; p.textContent=t; li.appendChild(p); ol.appendChild(li); });
      g.appendChild(ol);
    }
    (tail||[]).forEach(function(t){ var p=document.createElement("p"); p.textContent=t; g.appendChild(p); });
    if(btn){
      var x=document.createElement("button"); x.type="button"; x.className="btn-quiet";
      x.textContent=btn.label; x.addEventListener("click", btn.fn); g.appendChild(x);
    }
  }
  var SETUP_STEPS=[
    "In claude.ai open Settings, then Connectors.",
    "Add Higgsfield and sign in. Rendering is billed to that Higgsfield account, so it needs credit on it \u2014 a Claude subscription on its own does not cover it.",
    "Add Shopify and connect the HitLights store. That one is only used to look products up, so you can skip it and paste an image URL instead.",
    "Reload this page and allow both connectors when you are asked."
  ];
  var FALLBACK_LINE="Everything else on this page still works without them. Fill in the message, press Build the prompt pack, and you get the exact prompts to run in a Claude chat or to hand to someone who can.";

  // The page was never given connector access. This is a SHARING condition,
  // not something the viewer can fix in their own Claude settings, and it
  // looks identical whether or not they have the connectors installed.
  function noAccessGate(reason){
    gateShow("", "Connectors are switched off by how this page is shared",
      [reason,
       "This is not something you can fix on your side. It happens even when Higgsfield and Shopify are already connected on your account \u2014 the page was never handed connector access in the first place.",
       "A page that calls connectors is internal to the Claude organisation that owns it. It works for a signed-in member of that organisation, and never through a public or anyone-with-the-link share, or for an account outside it. Whoever shared this page needs to check both of those."],
      null,
      [FALLBACK_LINE],
      {label:"Check again", fn:function(){ boot(true); }});
  }

  // The page HAS connector access, but Higgsfield is missing from this
  // viewer's own connector list. This one the viewer can fix themselves.
  function noHiggsfieldGate(){
    gateShow("", "Higgsfield is not connected to your Claude account",
      ["The images are generated with your account and your credits, not with the account that built this page, so Higgsfield has to be connected here before the Generate button does anything."],
      SETUP_STEPS,
      [FALLBACK_LINE],
      {label:"Check again", fn:function(){ boot(true); }});
  }

  function diagnose(){
    return mcp.listTools().then(function(r){
      var list=(r&&r.servers)||[];
      var names=list.map(function(x){return (x.server||"").toLowerCase()});
      haveHF = names.indexOf(HF.toLowerCase())>-1;
      haveSH = names.indexOf(SH.toLowerCase())>-1;
      if(haveHF) refreshBalance();
      var haveGD = names.indexOf(GD.toLowerCase())>-1;
      var soft=[];
      if(!haveSH) soft.push("Shopify isn't connected, so catalog search is off \u2014 use the Paste an image URL tab.");
      if(!haveGD) soft.push("Google Drive isn't connected, so the Drive copy is off \u2014 the finished files still appear under Output with download buttons.");
      var lapsed=list.filter(function(x){return x.authStatus==="needs_reauth"}).map(function(x){return x.server});
      if(lapsed.length){
        gateShow("", "Reconnect "+lapsed.join(" and "),
          ["Access to "+lapsed.join(" and ")+" has lapsed on your Claude account, so calls to "+(lapsed.length>1?"them":"it")+" will fail until you reconnect."],
          ["In claude.ai open Settings, then Connectors.", "Reconnect "+lapsed.join(" and ")+" and sign in again.", "Come back here and press Check again."],
          [FALLBACK_LINE],{label:"Check again", fn:function(){ boot(true); }});
        logEl.textContent="Reconnect "+lapsed.join(" and ")+" to generate. The prompt pack still works.";
      } else if(haveHF && !soft.length){
        $("gate").hidden=true;
        logEl.textContent="Ready. Pick a product, check the message, then generate.";
      } else if(haveHF){
        gateShow("ok","Higgsfield is connected \u2014 generating works",
          soft.concat(["To add a connector: claude.ai \u2192 Settings \u2192 Connectors, then press Check again."]),
          null,null,{label:"Check again", fn:function(){ boot(true); }});
        logEl.textContent="Ready. "+(haveSH?"Pick a product":"Paste a product image URL")+", check the message, then generate.";
      } else {
        noHiggsfieldGate();
        logEl.textContent="Higgsfield is not connected. You can still build the prompt pack.";
      }
    }, function(){
      haveHF=true; haveSH=true; // could not enumerate; let the call itself report
      refreshBalance();
      $("gate").hidden=true;
      logEl.textContent="Ready. Pick a product, check the message, then generate.";
    });
  }

  // The published tool. A copy of this file opened anywhere else (a file preview in chat,
  // a download, a Drive/vault copy) has no window.claude and can never reach connectors.
  var LIVE_URL="https://claude.ai/artifact/4FxPbojAkC1vmdpvwTDqv4";
  function copyGate(){
    var g=$("gate"); g.hidden=false; g.className="gate"; g.innerHTML="";
    var b=document.createElement("b"); b.textContent="You're looking at a copy of the file, not the live Ad Builder"; g.appendChild(b);
    ["Connectors only work in the published tool on claude.ai. This page was opened from a file \u2014 a preview in a chat, a download, or a copy in Drive or your vault \u2014 so it can't reach Higgsfield, Shopify or Google Drive. Nothing is wrong with your connectors.",
     "Open the live tool instead. The prompt pack still works on this copy."].forEach(function(t){ var p=document.createElement("p"); p.textContent=t; g.appendChild(p); });
    var a=document.createElement("a"); a.href=LIVE_URL; a.target="_blank"; a.rel="noopener noreferrer";
    a.className="btn-gold"; a.style.display="inline-block"; a.style.textDecoration="none"; a.style.fontFamily="var(--display)"; a.style.fontWeight="700"; a.style.fontSize="14px"; a.style.borderRadius="999px";
    a.textContent="Open the live Ad Builder \u2197"; g.appendChild(a);
  }
  function boot(again){
    if(!(window.claude && window.claude.use)){
      copyGate();
      logEl.textContent="This is a file copy. Open the live Ad Builder to generate; the prompt pack works here.";
      return;
    }
    if(again) gateShow("", "Checking\u2026", ["Re-reading which connectors your account has."], null, null, null);
    window.claude.use("downloads").then(function(d){ if(d) dl=d; }, function(){});
    window.claude.use("sample").then(function(sm){
      if(sm){
        sample=sm; $("draftbox").hidden=false;
        // The text & logo check needs image input; without it the cards say so.
        try{ sm.limits().then(function(l){ imgCaps=(l&&l.images)||null; },function(){ imgCaps=null; }); }catch(e){ imgCaps=null; }
      }
    }, function(){});
    if(!db) window.claude.use("db").then(function(d){ if(d){ db=d; watchRuns(); } }, function(){});
    window.claude.use("mcp").then(function(m){
      if(!m){
        noAccessGate("This view was not given access to connectors at all, so the page cannot reach Higgsfield or Shopify.");
        logEl.textContent="No connector access in this view. You can still build the prompt pack.";
        return;
      }
      mcp=m; diagnose();
    }, function(){
      noAccessGate("This view could not load connector access.");
    });
  }
  showCost();
  renderKit($("kit"));
  boot(false);
})();
