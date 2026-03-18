const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const createFonction = async (req,res)=>{
    const {nom_fontion} = req.body

    await prisma.fonctions.create({data : {nom : nom_fontion}}).then((results)=>{
        if(results){
            return res.status(201).json({message:"Fonction crée avec succès"})
        }else{
            return res.status(404).json({message:"Erreur de creation"})
        }
    }).catch(error=>{console.log(error)})
}

const getAllfonctions = async(req,res)=>{

    await prisma.fonctions.findMany().then((results)=>{
        if(results.length){
            return res.status(200).json(results)
        }else{
            return res.status(404).json({message:"Aucune fonction"})
        }
    }).catch(error=>{console.log(error)})
}


const getOneFonction = async(req,res)=>{

    const {id_fonction} = req.params

    await prisma.fonctions.findUnique({where : {id : parseInt(id_fonction)}}).then((results)=>{
        if(results){
            return res.status(200).json(results)
        }else{
            return res.status(404).json({message:"Cette fonction n'existe pas"})
        }
    })
}


const modifyFontion = async(req,res)=>{
    const {id_fonction} = req.params
    const {newFonction}=req.body
    const fonction = await prisma.fonctions.findUnique({where:{id : parseInt(id_fonction)}})

    if(fonction){
        await prisma.fonctions.update({data : {nom : newFonction}}).then((results)=>{
            if(results){
                return res.status(201).json({message:"Fonction mise à jour!"})
            }
        }).catch(error=>{console.log(error)})
    }else{
        return res.status(404).json({message:"Fonction non trouvée"})
    }

}



module.exports = {getAllfonctions,getOneFonction,modifyFontion,createFonction}